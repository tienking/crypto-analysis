"""Estimated liquidation map from Binance open-interest history (pure numpy, no I/O).

Binance publishes no liquidation heatmap. Like the public heatmaps, this one is a model:
- every rise in open interest during a candle = new positions opened at that candle's
  typical price, one long and one short per contract;
- they are spread over a leverage mix; a long at entry E and leverage L is liquidated near
  E * (1 - 1/L + MAINT), a short near E * (1 + 1/L - MAINT);
- a level disappears once a later candle trades through it (it was liquidated);
- a fall in open interest closes positions pro rata (all open levels shrink).
What is left are the price levels where forced orders are still waiting.
"""
from __future__ import annotations

import numpy as np

# (leverage, share of new positions). Calibrated on BTC against the Coinglass heatmap
# (Nov 2026): a lower-leverage mix put the biggest clusters too far from price.
LEVERAGE_MIX = ((10, 0.05), (25, 0.20), (50, 0.40), (100, 0.35))
MAINT = 0.004  # maintenance margin, pulls the liquidation price slightly towards entry


def liquidation_levels(oi: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray):
    """Walk aligned OI (base units) + candles; `oi[i]` is measured at the open of candle i.

    Returns (price, usd, is_long) arrays of the levels still open after the last candle.
    """
    n = len(oi)
    typ = (high + low + close) / 3
    px = np.empty(0)
    usd = np.empty(0)
    is_long = np.empty(0, dtype=bool)
    lev_mult_long = np.array([1 - 1 / lv + MAINT for lv, _ in LEVERAGE_MIX])
    lev_mult_short = np.array([1 + 1 / lv - MAINT for lv, _ in LEVERAGE_MIX])
    shares = np.array([s for _, s in LEVERAGE_MIX])

    def sweep(j: int):
        nonlocal px, usd, is_long
        if not len(px):
            return
        hit = np.where(is_long, low[j] <= px, high[j] >= px)
        if hit.any():
            keep = ~hit
            px, usd, is_long = px[keep], usd[keep], is_long[keep]

    for i in range(1, n):
        j = i - 1                       # the OI change happened during candle j
        sweep(j)                        # older levels hit by candle j are gone
        d = oi[i] - oi[i - 1]
        if not np.isfinite(d):
            continue
        if d > 0:
            e = typ[j]
            amount = d * e * shares     # USD per leverage tier, for each side
            px = np.concatenate([px, e * lev_mult_long, e * lev_mult_short])
            usd = np.concatenate([usd, amount, amount])
            is_long = np.concatenate([is_long, np.ones(len(shares), bool), np.zeros(len(shares), bool)])
        elif d < 0 and oi[i - 1] > 0 and len(usd):
            usd = usd * (oi[i] / oi[i - 1])
    if n:
        sweep(n - 1)                    # the live candle liquidates too
    return px, usd, is_long


def liquidation_map(oi, high, low, close, price: float, range_pct: float, bin_pct: float = 0.25) -> dict | None:
    """Bin the open levels within ±range_pct of `price`. None when there is nothing to show."""
    if len(oi) < 2 or price <= 0:
        return None
    px, usd, is_long = liquidation_levels(np.asarray(oi, float), np.asarray(high, float),
                                          np.asarray(low, float), np.asarray(close, float))
    width = price * bin_pct / 100
    n_side = max(1, int(round(range_pct / bin_pct)))
    edges = price + width * np.arange(-n_side, n_side + 1)
    inside = (px >= edges[0]) & (px < edges[-1])
    if not inside.any():
        return None
    idx = np.clip(((px[inside] - edges[0]) // width).astype(int), 0, 2 * n_side - 1)
    long_usd = np.bincount(idx, weights=np.where(is_long[inside], usd[inside], 0.0), minlength=2 * n_side)
    short_usd = np.bincount(idx, weights=np.where(~is_long[inside], usd[inside], 0.0), minlength=2 * n_side)
    centers = (edges[:-1] + edges[1:]) / 2
    return {
        "price": float(price),
        "range_pct": float(range_pct),
        "bin_pct": float(bin_pct),
        "bins": [
            {"price": round(float(c), 10), "long": round(float(lu), 2), "short": round(float(su), 2)}
            for c, lu, su in zip(centers, long_usd, short_usd)
        ],
    }


def pull(liq: dict, min_dist_pct: float = 0.2):
    """Attraction of each side: Σ USD / distance%. Returns (up, down, top_short, top_long).

    up   = shorts waiting above (their forced buys pull price up),
    down = longs waiting below. top_* = (price, usd) of the biggest cluster on that side.
    """
    p = liq["price"]
    up = down = 0.0
    top_short = top_long = None
    for b in liq["bins"]:
        dist = max(abs(b["price"] / p - 1) * 100, min_dist_pct)
        if b["short"] > 0:  # swept levels are gone, so shorts sit above price, longs below
            up += b["short"] / dist
            if top_short is None or b["short"] > top_short[1]:
                top_short = (b["price"], b["short"])
        if b["long"] > 0:
            down += b["long"] / dist
            if top_long is None or b["long"] > top_long[1]:
                top_long = (b["price"], b["long"])
    return up, down, top_short, top_long
