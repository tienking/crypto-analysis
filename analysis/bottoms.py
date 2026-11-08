"""Bottom signals: how often a low like the current one held, measured on the backtest coins.

Two horizons, independent of the timeframe on screen:
- short: 4h candles. "At a 7-day low" = the lowest low of the last day (6 candles) is also
  the lowest of the last 7 days (42 candles). It counted as a bottom when none of the next
  42 candles traded below it.
- mid: 1d candles, last 7 days vs 60 days, held for the next 60 days.

Four bottom signs from RSI, MACD and volume, read at the last closed candle:
RSI ≤ 30 in the last 3 candles; bullish RSI divergence (a lower price low with a higher RSI
low, confirmed in the last 15 candles); MACD line below zero with the histogram rising for 2
candles; a capitulation candle (red, volume ≥ 2× the 20-candle average) in the last 5.

RATES[horizon][k] = share of past 7-day / 60-day lows with k signs (3 = 3 or more) that
held, from backtest/bottoms.py (full spot history of the coins in backtest.binance_hist.COINS).
The weekly backtest re-measures them into the `bottom_rates`
collection; the constants below are the fallback when the database has no active table.

The cycle checklist (weekly candles) is not a probability: Binance history holds only two
cycle bottoms (Dec 2018, Nov 2022), far too few to measure one.
"""
from __future__ import annotations

import numpy as np

from . import indicators as ind

PIVOT_W = 3
SIGNS = [
    ("rsi", "RSI quá bán (≤ 30)"),
    ("divergence", "Phân kỳ tăng RSI"),
    ("macd", "MACD âm nhưng đang hồi"),
    ("capitulation", "Nến bán tháo (volume ≥ 2×)"),
]
HORIZONS = {
    "short": {"tf": "4h", "recent": 6, "span": 42, "days": 7, "name": "Đáy ngắn hạn"},
    "mid": {"tf": "1d", "recent": 7, "span": 60, "days": 60, "name": "Đáy trung hạn"},
}
# Filled from backtest/bottoms.py (Nov 2026, 13 coins). RATES[h][k]: k = 0, 1, 2, 3+ signs; N = samples.
RATES = {"short": [0.191, 0.285, 0.305, 0.369], "mid": [0.22, 0.298, 0.338, 0.519]}
N = {"short": [5099, 14389, 12526, 2956], "mid": [782, 1861, 1445, 339]}
BASE = {"short": 0.285, "mid": 0.314}


def default_table() -> dict:
    """{horizon: {"rates", "samples", "base"}}, the shape stored in `bottom_rates`."""
    return {k: {"rates": list(RATES[k]), "samples": list(N[k]), "base": BASE[k]} for k in HORIZONS}


def valid_table(t) -> bool:
    try:
        return all(len(t[k]["rates"]) == 4 and len(t[k]["samples"]) == 4
                   and all(0 <= float(x) <= 1 for x in t[k]["rates"]) and 0 <= float(t[k]["base"]) <= 1
                   for k in HORIZONS)
    except (KeyError, TypeError, ValueError):
        return False

CYCLE_DRAWDOWN = 0.70        # price at least 70% under the all-time high
CYCLE_LOOKBACK = 8           # weeks for the RSI and capitulation conditions


def _prev_mean(v: np.ndarray, n: int = 20) -> np.ndarray:
    """Mean of the n values before each index (NaN until there are n)."""
    out = np.full(len(v), np.nan)
    cs = np.r_[0.0, np.cumsum(v)]
    for i in range(n, len(v)):
        out[i] = (cs[i] - cs[i - n]) / n
    return out


def sign_matrix(o, h, l, c, v) -> np.ndarray:
    """(n, 4) booleans: the four bottom signs at each candle, using only candles up to it."""
    o, h, l, c, v = (np.asarray(x, dtype=float) for x in (o, h, l, c, v))
    n = len(c)
    r = ind.rsi(c)
    dif, _, hist = ind.macd(c)
    _, lows = ind.pivots(h, l, PIVOT_W)
    piv = [p for p, _ in lows]
    cap = (c < o) & (v >= 2 * _prev_mean(v))
    S = np.zeros((n, 4), bool)
    for i in range(30, n):
        S[i, 0] = np.nanmin(r[i - 2:i + 1]) <= 30
        k = np.searchsorted(piv, i - PIVOT_W, side="right")     # pivots confirmed by candle i
        if k >= 2:
            p2, p1 = piv[k - 1], piv[k - 2]
            S[i, 1] = bool(i - p2 <= 15 and p2 - p1 <= 40 and l[p2] < l[p1] and r[p2] > r[p1] and r[p1] < 40)
        S[i, 2] = bool(dif[i] < 0 and hist[i] > hist[i - 1] > hist[i - 2])
        S[i, 3] = bool(cap[i - 4:i + 1].any())
    return S


def at_low(l, i: int, recent: int, span: int) -> bool:
    """The lowest low of the last `recent` candles is also the lowest of the last `span`."""
    return bool(i >= span and l[i - recent + 1:i + 1].min() <= l[i - span:i + 1].min())


def held(l, i: int, recent: int, span: int) -> bool:
    """At a low, and no candle of the next `span` trades below it (needs i + span < len)."""
    return bool(at_low(l, i, recent, span) and l[i - recent + 1:i + 1].min() <= l[i + 1:i + span + 1].min())


def horizon_view(c, key: str, table: dict | None = None) -> dict | None:
    """Bottom reading for one horizon. `c` = Candles whose last row is the live candle;
    `table` = the active rate table (default: the constants above)."""
    t = (table or default_table())[key]
    cfg = HORIZONS[key]
    recent, span = cfg["recent"], cfg["span"]
    i = len(c) - 2                                        # last closed candle
    if i < max(span, 60):
        return None
    S = sign_matrix(c.open, c.high, c.low, c.close, c.volume)[i]
    low = float(c.low[i - recent + 1:i + 1].min())
    span_low = float(c.low[i - span:i + 1].min())
    price = float(c.close[-1])
    is_low = at_low(c.low, i, recent, span)
    k = min(int(S.sum()), 3)
    return {
        "key": key, "name": cfg["name"], "tf": cfg["tf"], "days": cfg["days"],
        "at_low": is_low,
        "low": low, "span_low": span_low,
        "above_low_pct": float((price / span_low - 1) * 100),
        "broken": bool(c.low[-1] < low),                  # the live candle already went lower
        "signs": [{"id": sid, "name": name, "ok": bool(S[j])} for j, (sid, name) in enumerate(SIGNS)],
        "count": int(S.sum()),
        "rate": float(t["rates"][k]) if is_low else None,
        "samples": int(t["samples"][k]),
        "base": float(t["base"]),
    }


def cycle_view(w) -> dict | None:
    """Cycle-bottom checklist on weekly candles (last row = the live week)."""
    if len(w) < 40:
        return None
    i = len(w) - 2
    price = float(w.close[-1])
    ath = float(w.high.max())
    r = ind.rsi(w.close)
    dif, _, hist = ind.macd(w.close)
    cap = (w.close < w.open) & (w.volume >= 2 * _prev_mean(w.volume))
    lb = slice(i - CYCLE_LOOKBACK + 1, i + 1)
    ma200 = float(w.close[i - 199:i + 1].mean()) if i >= 199 else None
    rsi_min = float(np.nanmin(r[lb]))
    dd = price / ath - 1
    conds = [
        {"id": "drawdown", "name": f"Giảm ≥ {CYCLE_DRAWDOWN:.0%} từ đỉnh", "ok": dd <= -CYCLE_DRAWDOWN,
         "detail": f"Đang {dd * 100:.0f}% so với đỉnh {ath:.6g}"},
        {"id": "rsi", "name": "RSI tuần ≤ 30", "ok": rsi_min <= 30,
         "detail": f"Thấp nhất {CYCLE_LOOKBACK} tuần: {rsi_min:.0f}"},
        {"id": "ma200", "name": "Giá dưới MA200 tuần", "ok": None if ma200 is None else price < ma200,
         "detail": "Chưa đủ 200 tuần dữ liệu" if ma200 is None else f"MA200 tuần: {ma200:.6g}"},
        {"id": "capitulation", "name": "Tuần bán tháo (volume ≥ 2×)", "ok": bool(cap[lb].any()),
         "detail": f"Trong {CYCLE_LOOKBACK} tuần gần nhất"},
        {"id": "macd", "name": "MACD tuần âm nhưng đang hồi", "ok": bool(dif[i] < 0 and hist[i] > hist[i - 1]),
         "detail": "Lực bán tuần đang yếu dần" if dif[i] < 0 and hist[i] > hist[i - 1] else
                   ("MACD tuần dương" if dif[i] >= 0 else "Histogram tuần còn giảm")},
    ]
    for x in conds:
        if x["ok"] is not None:
            x["ok"] = bool(x["ok"])
    met = sum(1 for x in conds if x["ok"])
    avail = sum(1 for x in conds if x["ok"] is not None)
    return {"conditions": conds, "met": met, "available": avail, "weeks": len(w) - 1,
            "ath": ath, "drawdown_pct": dd * 100, "rsi_min": rsi_min, "ma200": ma200, "lookback": CYCLE_LOOKBACK,
            "level": "high" if met >= 4 else "some" if met == 3 else "low"}
