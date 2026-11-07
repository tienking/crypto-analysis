"""Bottom signals (analysis/bottoms.py): pure functions on synthetic candles."""
import numpy as np

from analysis.bottoms import BASE, RATES, at_low, cycle_view, default_table, held, horizon_view, sign_matrix, valid_table
from analysis.criteria import Candles
from backtest import bottoms as bb


def candles(close, vol=None, spike_at=None):
    close = np.asarray(close, dtype=float)
    o = np.r_[close[0], close[:-1]]
    v = np.full(len(close), 1000.0) if vol is None else np.asarray(vol, dtype=float)
    if spike_at is not None:
        v[spike_at] = 5000.0
    return Candles(o, np.maximum(o, close) * 1.002, np.minimum(o, close) * 0.998, close, v,
                   np.arange(len(close), dtype=np.int64) * 3_600_000)


def falling(n=200, rate=-0.01, seed=2):
    rng = np.random.default_rng(seed)
    return 100 * np.exp(np.cumsum(rate + rng.normal(0, 0.003, n)))


def test_at_low_and_held():
    l = np.array([5, 4, 3, 2, 1, 2, 3, 4, 5, 6], dtype=float)
    assert at_low(l, 4, 2, 4) and held(l, 4, 2, 4)
    assert not at_low(l, 8, 2, 4)                      # the 4-candle low is behind
    l2 = l.copy(); l2[7] = 0.5
    assert not held(l2, 4, 2, 4)                        # broken within the next 4 candles


def test_steep_fall_shows_oversold_and_capitulation():
    c = candles(falling(), spike_at=-3)
    S = sign_matrix(c.open, c.high, c.low, c.close, c.volume)
    assert S[-1, 0]                                     # RSI ≤ 30
    assert S[-1, 3]                                     # red candle with 5× volume, 3 candles ago
    assert not S[:30].any()                             # nothing before the warm-up


def test_horizon_view_at_a_low_uses_the_measured_rate():
    # last row = live candle; the closed ones end at a fresh low
    c = candles(np.r_[falling(), falling()[-1] * 1.001])
    v = horizon_view(c, "short")
    assert v["at_low"] and v["tf"] == "4h"
    assert v["rate"] == RATES["short"][min(v["count"], 3)] and v["base"] == BASE["short"]
    assert len(v["signs"]) == 4 and v["count"] == sum(s["ok"] for s in v["signs"])


def test_horizon_view_away_from_a_low_has_no_rate():
    c = candles(100 * np.exp(np.cumsum(np.full(200, 0.005))))
    v = horizon_view(c, "mid")
    assert not v["at_low"] and v["rate"] is None and v["above_low_pct"] > 10


def test_horizon_view_needs_enough_candles():
    assert horizon_view(candles(falling(50)), "short") is None


def test_cycle_checklist_after_a_crash():
    up = 100 * np.exp(np.cumsum(np.full(120, 0.02)))           # rally to an all-time high
    down = up[-1] * np.exp(np.cumsum(np.full(60, -0.03)))       # then -83%
    w = candles(np.r_[up, down, down[-1]], spike_at=-4)
    v = cycle_view(w)
    ids = {x["id"]: x for x in v["conditions"]}
    assert ids["drawdown"]["ok"] and ids["rsi"]["ok"] and ids["capitulation"]["ok"]
    assert ids["ma200"]["ok"] is None                           # under 200 weeks of history
    assert v["available"] == 4 and v["met"] >= 3


def test_cycle_checklist_in_a_bull_market():
    w = candles(100 * np.exp(np.cumsum(np.full(260, 0.01))))
    v = cycle_view(w)
    assert v["met"] == 0 and v["available"] == 5 and v["level"] == "low"


def good_tables():
    return {k: {"rates": list(t["rates"]), "samples": list(t["samples"]), "base": t["base"]}
            for k, t in default_table().items()}


def test_default_table_is_valid_and_bad_ones_are_not():
    assert valid_table(default_table())
    t = default_table(); t["mid"]["rates"] = [0.1, 0.2]
    assert not valid_table(t) and not valid_table(None) and not valid_table({"short": {}})
    t = default_table(); t["short"]["rates"][0] = 1.5
    assert not valid_table(t)


def test_guardrails():
    assert bb.decide(good_tables(), locked=False) == (True, "Passed the guardrails")
    assert bb.decide(good_tables(), locked=True)[0] is False
    t = good_tables(); t["mid"]["samples"][3] = 150
    assert bb.check(t) == (False, f"mid: a group has fewer than {bb.MIN_SAMPLES} lows")
    t = good_tables(); t["short"]["rates"] = [0.3, 0.2, 0.31, 0.38]        # 0 signs not the lowest
    assert bb.check(t)[0] is False
    t = good_tables(); t["short"]["rates"] = [0.1, 0.2, 0.5, 0.4]          # 3+ not the highest
    assert bb.check(t)[0] is False
    t = good_tables(); t["short"]["rates"][1] = None
    assert bb.check(t)[0] is False


class FakeColl:
    def __init__(self, docs=None):
        self.docs = docs or []

    def update_many(self, q, u):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                d.update(u["$set"])

    def insert_one(self, d):
        self.docs.append(d)


class FakeDb:
    def __init__(self):
        self.bottom_rates = FakeColl([{"active": True, "tables": default_table()}])


def test_update_activates_a_passing_table_and_keeps_a_failing_one(monkeypatch):
    db = FakeDb()
    halves = {"older": [0.2, 0.3, 0.3, 0.4], "newer": [0.2, 0.3, 0.3, 0.4]}
    monkeypatch.setattr(bb, "measure", lambda http: {k: {**t, **halves} for k, t in good_tables().items()})
    r = bb.update(db, http=None)
    assert r["applied"] and [d["active"] for d in db.bottom_rates.docs] == [False, True]
    bad = good_tables(); bad["mid"]["samples"][0] = 10
    monkeypatch.setattr(bb, "measure", lambda http: {k: {**t, **halves} for k, t in bad.items()})
    r = bb.update(db, http=None)
    assert not r["applied"] and [d["active"] for d in db.bottom_rates.docs] == [False, True, False]
    r = bb.update(db, http=None, locked=True)
    assert not r["applied"]


def test_table_measures_rates_per_sign_count():
    n = 300
    rng = np.random.default_rng(3)
    c = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, n)))
    a = {"o": np.r_[c[0], c[:-1]], "h": c * 1.01, "l": c * 0.99, "c": c, "v": np.full(n, 1000.0)}
    t = bb.table([a], 6, 42)
    assert sum(t["samples"]) > 0 and 0 <= t["base"] <= 1
    assert all(r is None or 0 <= r <= 1 for r in t["rates"])


def test_horizon_view_uses_the_given_table():
    c = candles(np.r_[falling(), falling()[-1] * 1.001])
    t = default_table(); t["short"]["rates"] = [0.01, 0.02, 0.03, 0.04]
    v = horizon_view(c, "short", t)
    assert v["rate"] == [0.01, 0.02, 0.03, 0.04][min(v["count"], 3)]
