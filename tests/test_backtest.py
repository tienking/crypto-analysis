"""Backtest archive helpers, the weight-fitting guardrails and the replay engine (no network, no DB)."""
import os

os.environ.setdefault("MONGODB_URL", "mongodb://localhost:1")
os.environ.setdefault("JWT_SECRET", "test-secret")

from datetime import datetime

import numpy as np
import pytest

from backtest import engine
from backtest.fit import cap, ic_weights, propose
from backtest.store import SLOTS, group_of, merge_points, rollback_target, series_from_docs

DAY = 86_400_000
D0 = 20_000 * DAY            # a UTC midnight


# ── archive buckets ──────────────────────────────────────────────────────────────

def test_merge_points_fills_slots_and_keeps_other_fields():
    doc = merge_points(None, "BTCUSDT", "oi", [(D0, 1.0), (D0 + 300_000, 2.0)])
    assert doc["_id"].startswith("BTCUSDT:") and len(doc["oi"]) == SLOTS
    assert doc["oi"][:3] == [1.0, 2.0, None]
    doc = merge_points(doc, "BTCUSDT", "oi_usd", [(D0 + 600_000, 9.0)])
    doc = merge_points(doc, "BTCUSDT", "oi", [(D0 + 600_000, 3.0)])   # later run fills a gap
    assert doc["oi"][:3] == [1.0, 2.0, 3.0] and doc["oi_usd"][2] == 9.0


def test_merge_points_rejects_two_days():
    with pytest.raises(ValueError):
        merge_points(None, "BTCUSDT", "oi", [(D0, 1.0), (D0 + DAY, 2.0)])


def test_series_from_docs_resamples_on_a_grid():
    a = merge_points(None, "X", "oi", [(D0 + i * 300_000, float(i)) for i in range(12)])
    b = merge_points(None, "X", "oi", [(D0 - DAY, 5.0)])
    s = series_from_docs([a, b], "oi", 900_000)                # 15m points only, oldest first
    assert s == [(D0 - DAY, 5.0), (D0, 0.0), (D0 + 900_000, 3.0), (D0 + 1_800_000, 6.0), (D0 + 2_700_000, 9.0)]


def test_rollback_target_walks_back():
    t = lambda d: datetime(2026, 11, d)  # noqa: E731
    sets = [{"created_at": t(1)}, {"created_at": t(8)}, {"created_at": t(15), "active": True}]
    assert rollback_target(sets)["created_at"] == t(8)
    sets = [{"created_at": t(1)}, {"created_at": t(8), "active": True}, {"created_at": t(15)}]
    assert rollback_target(sets)["created_at"] == t(1)
    assert rollback_target([{"created_at": t(1), "active": True}]) is None


def test_group_of():
    assert [group_of(t) for t in ("5m", "1h", "4h", "1d")] == ["short", "short", "long", "long"]


# ── fitting + guardrails ─────────────────────────────────────────────────────────

CUR = {"htf": 20, "trend": 20, "structure": 15, "momentum": 15, "volume": 15, "btc": 15}


def make_rows(predictive="trend", n=3000, seed=0, strength=0.6):
    """Rows where only `predictive` carries information about z."""
    rng = np.random.default_rng(seed)
    rows = []
    for tf in ("4h", "12h", "1d"):
        for i in range(n):
            s = {c: float(rng.choice([-1, -0.5, 0, 0.5, 1])) for c in CUR}
            z = strength * s[predictive] + rng.normal() if predictive else rng.normal()
            rows.append({"coin": "BTC", "tf": tf, "t": i, "z": z, "ret": z / 100, **s})
    return rows


def test_ic_weights():
    assert ic_weights({"a": -0.1, "b": 0.0}, 90) is None
    w = ic_weights({"a": 0.03, "b": 0.01, "c": -0.02}, 80)
    assert w == pytest.approx({"a": 60, "b": 20, "c": 0})


def test_cap_limits_each_move_and_keeps_the_total():
    out = cap(CUR, {"htf": 0, "trend": 100, "structure": 0, "momentum": 0, "volume": 0, "btc": 0})
    assert sum(out.values()) == sum(CUR.values())
    assert all(abs(out[k] - CUR[k]) <= 3 for k in CUR)
    assert out["trend"] > CUR["trend"] and out["htf"] < CUR["htf"]


def test_propose_applies_a_better_set():
    res = propose(make_rows("trend"), CUR, list(CUR), ("4h", "12h", "1d"))
    assert res["applied"] and res["weights"]["trend"] > CUR["trend"]
    assert sum(res["weights"].values()) == sum(CUR.values())
    assert res["test_ic_proposed"] > res["test_ic_current"]


def test_propose_respects_the_lock():
    res = propose(make_rows("trend"), CUR, list(CUR), ("4h", "12h", "1d"), locked=True)
    assert not res["applied"] and res["weights"] == CUR and "locked" in res["reason"]
    assert res["proposed"]["trend"] > CUR["trend"]            # the proposal is still recorded


def test_propose_keeps_weights_when_nothing_predicts():
    rows = make_rows(None)
    for r in rows:   # every criterion anti-correlated with the outcome
        for c in CUR:
            r[c] = -1.0 if r["z"] > 0 else 1.0
    res = propose(rows, CUR, list(CUR), ("4h", "12h", "1d"))
    assert not res["applied"] and res["weights"] == CUR and "positive IC" in res["reason"]


def test_propose_leaves_unfitted_criteria_alone():
    cur = {**CUR, "derivatives": 5, "liquidation": 5}
    rows = make_rows("trend")
    for r in rows:
        r["derivatives"] = r["liquidation"] = None
    res = propose(rows, cur, list(CUR), ("4h", "12h", "1d"))
    assert res["weights"]["derivatives"] == 5 and res["weights"]["liquidation"] == 5
    # allowed to move, but without data in this group: still kept
    res = propose(rows, cur, list(cur), ("4h", "12h", "1d"))
    assert res["applied"] and res["weights"]["derivatives"] == 5 and res["weights"]["liquidation"] == 5
    assert sum(res["weights"].values()) == sum(cur.values())


# ── replay engine ────────────────────────────────────────────────────────────────

def arrays(n, step, seed=1):
    rng = np.random.default_rng(seed)
    c = 100 * np.exp(np.cumsum(rng.normal(0.001, 0.01, n)))
    o = np.concatenate([[c[0]], c[:-1]])
    t = (np.arange(n) * step + D0 - 400 * DAY).astype(np.int64)
    return {"t": t, "o": o, "h": np.maximum(o, c) * 1.002, "l": np.minimum(o, c) * 0.998, "c": c, "v": rng.uniform(1, 2, n)}


def test_engine_price_rows_use_the_app_criteria():
    h4 = arrays(1200, 4 * 3_600_000)
    d1 = {k: v[::6] for k, v in h4.items()}                   # same series on 1d (open = first 4h open)
    d1["c"] = h4["c"][5::6]
    rows = engine.run({"spot": {"BTC": {"4h": h4, "1d": d1}}}, [("price", "BTC", "4h")], workers=1)
    assert len(rows) > 100
    r = rows[0]
    assert set(r) >= {"htf", "trend", "structure", "momentum", "volume", "btc", "z"}
    assert r["btc"] is None                                     # analysing BTC itself
    assert all((x["t"] // (4 * 3_600_000)) % engine.H == 0 for x in rows)   # shared absolute grid
    assert all(-1 <= x["trend"] <= 1 for x in rows if x["trend"] is not None)


def test_run_history_points_follow_the_weights_in_effect():
    import database
    t = lambda d: datetime(2026, 11, d)  # noqa: E731
    runs = [
        {"started_at": t(15), "groups": {"short": {"applied": True, "test_ic_current": 0.01, "test_ic_proposed": 0.02},
                                          "long": {"applied": False, "test_ic_current": 0.07, "test_ic_proposed": 0.071}}},
        {"started_at": t(8), "groups": {"long": {"applied": False, "test_ic_current": 0.06}}},
    ]
    h = database.run_history(runs)
    assert [p["started_at"] for p in h] == [t(8), t(15)]                     # oldest first
    assert "short" not in h[0] and h[0]["long"] == {"ic": 0.06, "applied": False, "before": 0.06}
    assert h[1]["short"] == {"ic": 0.02, "applied": True, "before": 0.01}   # applied -> the proposal's IC
    assert h[1]["long"]["ic"] == 0.07                                        # kept -> the current set's IC


def test_reset_clears_results_but_keeps_the_archive():
    from backtest.reset import reset

    class Col:
        def __init__(self, n): self.n = n
        def delete_many(self, q):
            assert q == {}
            n, self.n = self.n, 0
            return type("R", (), {"deleted_count": n})()

    db = {"runs": Col(3), "weight_sets": Col(4), "bottom_rates": Col(2), "market_5m": Col(900), "state": Col(1)}
    assert reset(db) == {"runs": 3, "weight_sets": 4, "bottom_rates": 2}
    assert db["market_5m"].n == 900 and db["state"].n == 1
