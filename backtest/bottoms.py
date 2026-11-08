"""Measure the bottom-signal hit rates behind analysis/bottoms.py and store them.

    python -m backtest.bottoms            # measure, store, apply if the guardrails pass
    python -m backtest.bottoms --dry-run  # measure and print only

Also run every week by backtest.reweight. For every closed candle where price sits at a
7-day (4h) / 60-day (1d) low, count the bottom signs and check whether that low held for the
next 7 / 60 days, on the full spot history of the backtest coins (~3 min of downloads).

Every run is stored in `bottom_rates`; the app reads the one with `active: true` (code
defaults in analysis/bottoms.py when there is none). A new table becomes active only if each
sign-count group has MIN_SAMPLES lows, 0 signs is the lowest rate and 3+ the highest, and
the weights are not locked.
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timezone

import numpy as np

from analysis.bottoms import HORIZONS, at_low, held, sign_matrix

from .binance_hist import COINS, Http, cached_klines

MIN_SAMPLES = 200


def table(series: list[dict], recent: int, span: int) -> dict:
    rows = []
    for a in series:
        S = sign_matrix(a["o"], a["h"], a["l"], a["c"], a["v"])
        n = len(a["c"])
        for i in range(span, n - span):
            if at_low(a["l"], i, recent, span):
                rows.append((min(int(S[i].sum()), 3), int(held(a["l"], i, recent, span)), i >= n // 2))
    X = np.array(rows).reshape(-1, 3)
    r3 = lambda v: round(float(v), 3) if v == v else None  # noqa: E731 — NaN (empty group) -> None
    mean = lambda m: X[m, 1].mean() if m.any() else float("nan")  # noqa: E731
    out = {"base": r3(mean(np.ones(len(X), bool))), "rates": [], "samples": [], "older": [], "newer": []}
    for k in range(4):
        m = X[:, 0] == k
        out["rates"].append(r3(mean(m)))
        out["samples"].append(int(m.sum()))
        out["older"].append(r3(mean(m & (X[:, 2] == 0))))
        out["newer"].append(r3(mean(m & (X[:, 2] == 1))))
    return out


def measure(http: Http, db=None) -> dict:
    out = {}
    now = int(time.time() * 1000)
    for key, cfg in HORIZONS.items():
        series = [s for s in (cached_klines(db, http, c + "USDT", cfg["tf"], 30000, now) for c in COINS) if s is not None]
        out[key] = table(series, cfg["recent"], cfg["span"])
    return out


def check(tables: dict) -> tuple[bool, str]:
    """Guardrails: enough lows per group, 0 signs lowest, 3+ highest."""
    for key in HORIZONS:
        t = tables.get(key)
        if not t or None in t["rates"] or t["base"] is None:
            return False, f"{key}: missing data"
        if min(t["samples"]) < MIN_SAMPLES:
            return False, f"{key}: a group has fewer than {MIN_SAMPLES} lows"
        r = t["rates"]
        if r[0] != min(r) or r[3] != max(r):
            return False, f"{key}: 0 signs is not the lowest rate or 3+ not the highest"
    return True, "Passed the guardrails"


def decide(tables: dict, locked: bool) -> tuple[bool, str]:
    ok, reason = check(tables)
    if ok and locked:
        return False, "Locked: measured but not applied"
    return ok, reason


def update(db, http: Http, locked: bool = False) -> dict:
    """Measure, store the run, activate it if it passes. Returns a short summary."""
    tables = measure(http, db)
    applied, reason = decide(tables, locked)
    doc = {"created_at": datetime.now(timezone.utc), "applied": applied, "reason": reason, "active": False,
           "tables": {k: {f: t[f] for f in ("rates", "samples", "base")} for k, t in tables.items()},
           "halves": {k: {f: t[f] for f in ("older", "newer")} for k, t in tables.items()}}
    if applied:
        db.bottom_rates.update_many({"active": True}, {"$set": {"active": False}})
        doc["active"] = True
    db.bottom_rates.insert_one(doc)
    return {"applied": applied, "reason": reason, "tables": doc["tables"]}


def main():
    http = Http()
    if "--dry-run" in sys.argv:
        for key, t in measure(http).items():
            print(f"{key}: BASE {t['base']}  RATES {t['rates']}  N {t['samples']}")
            print(f"   older half {t['older']}  newer half {t['newer']}", flush=True)
        return
    from .store import sync_db
    db = sync_db()
    locked = bool((db.state.find_one({"_id": "weights"}) or {}).get("locked"))
    r = update(db, http, locked)
    print(f"[bottoms] {'applied' if r['applied'] else 'kept'} ({r['reason']}): {r['tables']}", flush=True)


if __name__ == "__main__":
    main()
