import numpy as np

from analysis import indicators as ind


def test_ema_constant_series():
    out = ind.ema([5.0] * 30, 10)
    assert np.isnan(out[8]) and out[9] == 5.0 and out[-1] == 5.0


def test_rsi_extremes():
    up = np.arange(1, 50, dtype=float)
    assert ind.rsi(up)[-1] == 100.0
    down = up[::-1].copy()
    assert ind.rsi(down)[-1] < 1.0


def test_macd_sign_follows_trend():
    up = np.linspace(100, 200, 120)
    _, _, hist = ind.macd(up)
    dif, _, _ = ind.macd(up)
    assert dif[-1] > 0
    assert not np.isnan(hist[-1])


def test_adx_strong_trend_vs_flat():
    n = 150
    c = np.linspace(100, 300, n)
    a, pdi, mdi = ind.adx(c + 1, c - 1, c, 14)
    assert a[-1] > 40 and pdi[-1] > mdi[-1]
    rng = np.random.default_rng(0)
    flat = 100 + rng.normal(0, 0.5, n)
    a2, _, _ = ind.adx(flat + 0.5, flat - 0.5, flat, 14)
    assert a2[-1] < a[-1]


def test_pivots_found():
    x = np.array([1, 2, 3, 5, 3, 2, 1, 2, 3, 6, 3, 2, 1], dtype=float)
    highs, lows = ind.pivots(x, x, 2)
    assert [i for i, _ in highs] == [3, 9]
    assert [i for i, _ in lows] == [6]
