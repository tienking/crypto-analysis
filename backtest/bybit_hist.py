"""Bybit USDT-perpetual history for backtesting derivatives and liquidation.

Binance keeps its 5m open-interest history for only ~30 days; Bybit serves it back to 2021
(5min/15min/30min/1h/4h/1d). The derivative replay in engine.deriv_rows therefore uses
Bybit's OI, futures candles and funding, over the same span as the spot candles of each
timeframe (from 2020 at most), so both halves of the train/test split hold derivative rows.
The live app still reads Binance.
"""
from __future__ import annotations

import numpy as np

from . import cache
from .binance_hist import Http

API = "https://api.bybit.com/v5/market/"
FLOOR = 1577836800000                   # 2020-01-01: Bybit OI history starts in 2020
PAUSE = 0.1                             # Bybit allows ~120 public requests per second per IP
STEP = {"5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
        "4h": 14_400_000, "12h": 43_200_000, "1d": 86_400_000}
KLINE = {"5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "12h": "720", "1d": "D"}
OI_INTERVAL = {"5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1d"}
OI_FROM = {"2h": "1h", "12h": "4h"}      # no 2h / 12h OI interval: keep every 2nd / 3rd point
FUNDING_PAGE = 200 * 8 * 3_600_000      # 200 settlements of 8 h


def _get(http: Http, endpoint: str, params: dict) -> list:
    """`result.list` of a Bybit v5 call; [] for an unknown symbol, raises on other errors."""
    d = http.get(API + endpoint, params)
    if d is None:
        return []
    if d.get("retCode") != 0:
        if d.get("retCode") == 10001:          # params error, e.g. symbol not listed
            return []
        raise RuntimeError(f"Bybit {endpoint}: {d.get('retCode')} {d.get('retMsg')}")
    return d["result"]["list"]


def klines(http: Http, symbol: str, tf: str, start: int, end: int) -> dict | None:
    """Closed candles opened in [start, end) as numpy arrays {t, o, h, l, c, v}."""
    rows, hi = {}, end - 1
    while hi >= start:
        lst = _get(http, "kline", {"category": "linear", "symbol": symbol, "interval": KLINE[tf],
                                   "start": start, "end": hi, "limit": 1000})
        for x in lst:
            if int(x[0]) + STEP[tf] <= end:      # drop the forming candle
                rows[int(x[0])] = [float(v) for v in x[:6]]
        if len(lst) < 1000:
            break
        hi = min(int(x[0]) for x in lst) - 1
    if not rows:
        return None
    a = np.array([rows[k] for k in sorted(rows)])
    return {"t": a[:, 0].astype(np.int64), "o": a[:, 1], "h": a[:, 2], "l": a[:, 3], "c": a[:, 4], "v": a[:, 5]}


def open_interest(http: Http, symbol: str, tf: str, start: int, end: int) -> list[tuple[int, float]]:
    """[(ts, OI in coins)] for a tf in OI_INTERVAL, oldest first."""
    pts, hi = {}, end
    while hi >= start:
        lst = _get(http, "open-interest", {"category": "linear", "symbol": symbol, "intervalTime": OI_INTERVAL[tf],
                                           "startTime": start, "endTime": hi, "limit": 200})
        for x in lst:
            pts[int(x["timestamp"])] = float(x["openInterest"])
        if len(lst) < 200:
            break
        hi = min(int(x["timestamp"]) for x in lst) - 1
    return sorted(pts.items())


def funding(http: Http, symbol: str, start: int, end: int) -> list[tuple[int, float]]:
    """[(ts, rate in %)], oldest first. Pages by time window (the endpoint has no cursor)."""
    pts, hi = {}, end
    while hi > start:
        lo = max(start, hi - FUNDING_PAGE)
        for x in _get(http, "funding/history", {"category": "linear", "symbol": symbol,
                                                 "startTime": lo, "endTime": hi, "limit": 200}):
            pts[int(x["fundingRateTimestamp"])] = float(x["fundingRate"]) * 100
        hi = lo
    return sorted(pts.items())


def starts(tfs, liq_period: dict, now: int, n: int, warmup: int) -> dict:
    """First timestamp to download per tf: n candles (+ warm-up) for each tf, and enough of its
    liquidation-period series to cover that span plus the 500 points the map looks back."""
    out = {tf: max(FLOOR, now - (n + warmup) * STEP[tf]) for tf in tfs}
    for tf in tfs:
        lp = liq_period[tf]
        out[lp] = max(FLOOR, min(out.get(lp, now), out[tf] - 520 * STEP[lp]))
    return out


def load_coin(http: Http, coin: str, tfs, liq_period: dict, now: int, n: int, warmup: int, db=None) -> dict | None:
    """engine.deriv_rows input for one coin: {"oi": {tf: [(ts, oi, oi_usd)]}, "fut": {tf: candles},
    "funding": [(ts, %)]}. None when Bybit does not list the coin. With `db`, every series goes
    through the download cache (only what is new since the last run is fetched)."""
    symbol = coin + "USDT"
    start = starts(tfs, liq_period, now, n, warmup)
    need = sorted(start, key=STEP.get)
    key = lambda kind, tf: f"bybit:{kind}:{symbol}:{tf}"
    fut = {tf: cache.series(db, key("kline", tf), start[tf], now, lambda a, b, tf=tf: klines(http, symbol, tf, a, b))
           for tf in need}
    if all(v is None for v in fut.values()):
        return None
    src_start = {}
    for tf in need:
        src = OI_FROM.get(tf, tf)
        src_start[src] = min(src_start.get(src, now), start[tf])
    fetched = {src: cache.points(cache.series(db, key("oi", src), s, now, lambda a, b, src=src: cache.from_points(
        open_interest(http, symbol, src, a, b)))) for src, s in src_start.items()}
    raw = {tf: [(t, v) for t, v in fetched[OI_FROM.get(tf, tf)] if t % STEP[tf] == 0 and t >= start[tf]]
           for tf in need}
    oi = {}
    for tf in need:
        k = fut[tf]
        px = dict(zip(k["t"].tolist(), k["c"].tolist())) if k is not None else {}
        oi[tf] = [(t, v, v * px[t]) for t, v in raw[tf] if t in px]   # USD value at that candle's close
    f0 = min(start.values()) - 30 * 86_400_000
    fr = cache.series(db, key("funding", "8h"), f0, now, lambda a, b: cache.from_points(funding(http, symbol, a, b)))
    return {"oi": oi, "fut": fut, "funding": cache.points(fr)}
