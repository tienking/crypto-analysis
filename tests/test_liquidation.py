"""Liquidation map model + criterion on hand-made data (no network)."""
import numpy as np
import pytest

from analysis.config import Thresholds
from analysis.criteria import Candles, Context, crit_liquidation
from analysis.liquidation import LEVERAGE_MIX, MAINT, liquidation_levels, liquidation_map, pull


def flat(n, price=100.0, wick=0.001):
    c = np.full(n, price)
    return c * (1 + wick), c * (1 - wick), c


def test_new_oi_creates_long_below_and_short_above():
    high, low, close = flat(3)
    oi = np.array([10.0, 20.0, 20.0])            # +10 coins during candle 0, at price 100
    px, usd, is_long = liquidation_levels(oi, high, low, close)
    assert len(px) == 2 * len(LEVERAGE_MIX)
    lev10 = 100 * (1 - 1 / 10 + MAINT)
    assert np.isclose(px[is_long].min(), lev10)
    assert (px[is_long] < 100).all() and (px[~is_long] > 100).all()
    # one long and one short per contract: same USD on both sides
    assert np.isclose(usd[is_long].sum(), 10 * 100) and np.isclose(usd[~is_long].sum(), 10 * 100)


def test_level_disappears_once_price_trades_through_it():
    high, low, close = flat(4)
    low[3] = 98.0                                 # later wick down 2%: 100x and 50x longs liquidated
    oi = np.array([10.0, 20.0, 20.0, 20.0])
    px, _, is_long = liquidation_levels(oi, high, low, close)
    assert (px[is_long] < 98.0).all()
    assert is_long.sum() == 2                     # only the 10x and 25x longs survive
    assert (~is_long).sum() == len(LEVERAGE_MIX)  # shorts untouched


def test_falling_oi_shrinks_open_levels():
    high, low, close = flat(3)
    _, usd, _ = liquidation_levels(np.array([10.0, 20.0, 10.0]), high, low, close)
    assert np.isclose(usd.sum(), 2 * 10 * 100 * 0.5)   # half of OI closed


def test_map_bins_and_pull_side():
    high, low, close = flat(3)
    m = liquidation_map([10.0, 20.0, 20.0], high, low, close, price=100.0, range_pct=5)
    assert len(m["bins"]) == 40
    up, down, top_s, top_l = pull(m)
    assert up > 0 and down > 0 and top_s[0] > 100 > top_l[0]


def ctx_with(liq):
    rng = np.random.default_rng(0)
    cl = 100 + np.cumsum(rng.normal(0, 0.3, 300))
    c = Candles(cl, cl + 0.2, cl - 0.2, cl, np.full(300, 1000.0), np.arange(300))
    return Context(c=c, t=Thresholds(), liq=liq)


def one_sided(short_usd, long_usd):
    """Shorts at +1%, longs at -4%: the closer side should win unless it is much smaller."""
    return {"price": 100.0, "range_pct": 5, "bin_pct": 0.25,
            "bins": [{"price": 101.0, "long": 0, "short": short_usd}, {"price": 96.0, "long": long_usd, "short": 0}]}


@pytest.mark.parametrize("short_usd,long_usd,expected", [
    (1e6, 1e6, 1.0),     # same size, shorts 4x closer -> strong pull up
    (1e6, 2e6, 0.5),     # longs bigger but farther -> still a lean up
    (1e6, 4e6, 0.0),     # balanced pull -> neutral
    (1e5, 1e7, -1.0),    # longs far bigger -> pull down
])
def test_criterion_follows_the_stronger_pull(short_usd, long_usd, expected):
    r = crit_liquidation(ctx_with(one_sided(short_usd, long_usd)))
    assert r.score == expected, r.detail


def test_criterion_na_without_data():
    assert crit_liquidation(ctx_with(None)).score is None
