"""Turn backtest rows into a weight proposal, with guardrails. Pure functions (unit-tested).

1. Split each (coin, timeframe) history in time: older half = train, newer half = test.
2. Candidate = the free budget shared in proportion to each criterion's train IC
   (mean over the group's timeframes; negative IC -> 0).
3. Cap: step towards the candidate so that no weight moves more than MAX_STEP points per run.
4. Apply only if the capped set's composite IC on the test half beats the current set's.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np

MAX_STEP = 3
MIN_GAIN = 0.002   # test-IC improvement needed to bother changing anything


def split(rows: list[dict]):
    by = defaultdict(list)
    for r in rows:
        by[(r["coin"], r["tf"])].append(r)
    train, test = [], []
    for v in by.values():
        v.sort(key=lambda r: r["t"])
        h = len(v) // 2
        train += v[:h]
        test += v[h:]
    return train, test


def ic(scores, z) -> float:
    s, z = np.asarray(scores, float), np.clip(np.asarray(z, float), -6, 6)
    if len(s) < 30 or not s.std() or not z.std():
        return 0.0
    return float(np.corrcoef(s, z)[0, 1])


def criterion_ic(rows: list[dict], cid: str, tfs) -> dict:
    """IC per timeframe (only rows where the criterion has data)."""
    out = {}
    for tf in tfs:
        rs = [r for r in rows if r["tf"] == tf and r.get(cid) is not None]
        if len(rs) >= 30:
            out[tf] = ic([r[cid] for r in rs], [r["z"] for r in rs])
    return out


def composite(row: dict, w: dict) -> float:
    act = [(w[c], row[c]) for c in w if row.get(c) is not None and w[c] > 0]
    tw = sum(x for x, _ in act)
    return sum(x * s for x, s in act) / tw if tw else 0.0


def composite_ic(rows: list[dict], w: dict, tfs) -> float:
    """Mean over timeframes of the composite score's IC (each timeframe counts equally)."""
    vals = []
    for tf in tfs:
        rs = [r for r in rows if r["tf"] == tf]
        if len(rs) >= 30:
            vals.append(ic([composite(r, w) for r in rs], [r["z"] for r in rs]))
    return float(np.mean(vals)) if vals else 0.0


def ic_weights(train_ic: dict, budget: float) -> dict | None:
    """Share `budget` points by positive mean IC. None if no criterion has a positive IC."""
    pos = {c: max(v, 0.0) for c, v in train_ic.items()}
    tot = sum(pos.values())
    if tot <= 0:
        return None
    return {c: budget * v / tot for c, v in pos.items()}


def cap(current: dict, candidate: dict, max_step: float = MAX_STEP) -> dict:
    """Step from `current` towards `candidate` (same total) by the largest fraction that moves
    no weight more than `max_step`, then round to integers keeping the total (largest
    remainders get the leftover points)."""
    keys = list(candidate)
    total = int(round(sum(current[k] for k in keys)))
    delta = {k: candidate[k] - current[k] for k in keys}
    biggest = max((abs(v) for v in delta.values()), default=0.0)
    alpha = 1.0 if biggest <= max_step else max_step / biggest
    target = {k: max(0.0, current[k] + alpha * delta[k]) for k in keys}
    out = {k: int(np.floor(v)) for k, v in target.items()}
    for k in sorted(keys, key=lambda k: target[k] - out[k], reverse=True)[:max(total - sum(out.values()), 0)]:
        out[k] += 1
    return out


def propose(rows: list[dict], current: dict, fit_ids: list[str], tfs, locked: bool = False) -> dict:
    """Decide the next weight set of one group. `fit_ids` = criteria allowed to move."""
    tfs = list(tfs)
    rows = [r for r in rows if r["tf"] in tfs]
    train, test = split(rows)
    per_tf = {c: criterion_ic(rows, c, tfs) for c in fit_ids}
    # A criterion without enough rows here (e.g. no OI archive yet on these timeframes) keeps
    # its weight instead of being pushed to 0 by a missing IC.
    by_tf = {c: criterion_ic(train, c, tfs) for c in fit_ids}
    fit_ids = [c for c in fit_ids if by_tf[c]]
    train_ic = {c: float(np.mean(list(by_tf[c].values()))) for c in fit_ids}
    budget = sum(current[c] for c in fit_ids)
    result = {"current": current, "ic_by_tf": per_tf, "train_ic": train_ic,
              "test_ic_current": composite_ic(test, current, tfs), "n_rows": len(rows)}
    cand = ic_weights(train_ic, budget)
    if cand is None:
        return {**result, "applied": False, "weights": current,
                "reason": "No criterion had a positive IC on the older half: weights kept."}
    new = {**current, **cap({c: current[c] for c in fit_ids}, cand)}
    result.update(candidate={c: round(v, 2) for c, v in cand.items()}, proposed=new,
                  test_ic_proposed=composite_ic(test, new, tfs))
    if new == current:
        return {**result, "applied": False, "weights": current, "reason": "The proposal equals the current weights."}
    if result["test_ic_proposed"] < result["test_ic_current"] + MIN_GAIN:
        return {**result, "applied": False, "weights": current,
                "reason": "The proposal did not beat the current weights on the newer half: weights kept."}
    if locked:
        return {**result, "applied": False, "weights": current, "reason": "Weights are locked in Admin: proposal not applied."}
    return {**result, "applied": True, "weights": new, "reason": "Beat the current weights on the newer half."}
