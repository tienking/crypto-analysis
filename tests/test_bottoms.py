"""Bottom signals (analysis/bottoms.py): pure functions on synthetic candles."""
import numpy as np

from analysis.bottoms import BASE, RATES, at_low, cycle_view, held, horizon_view, sign_matrix
from analysis.criteria import Candles


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
