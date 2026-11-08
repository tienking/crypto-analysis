"""Synchronous Binance history downloads for the scripts (paginated, throttled, retried)."""
from __future__ import annotations

import time

import httpx
import numpy as np

SPOT = "https://api.binance.com"
FAPI = "https://fapi.binance.com"
# Not here: BGB (not listed on Binance) and HYPE (Binance spot only since Sep 2026; it trades
# mostly on Hyperliquid, so Binance data represents it poorly). Checked Nov 2026.
COINS = ("BTC", "ETH", "BNB", "XRP", "SOL", "TRX", "DOGE", "ADA", "LTC", "AVAX", "SUI", "TAO", "DOT")
PAUSE = 0.25  # seconds between requests: /futures/data allows 1000 requests per 5 min per IP


class Http:
    def __init__(self):
        self.c = httpx.Client(timeout=30, headers={"User-Agent": "crypto-analysis-backtest/1.0"})

    def get(self, url: str, params: dict):
        last = None
        for attempt in range(5):
            time.sleep(PAUSE)
            try:
                r = self.c.get(url, params=params)
                if r.status_code == 200:
                    return r.json()
                if r.status_code == 400:      # unknown symbol / bad period: not worth retrying
                    return None
                last = f"HTTP {r.status_code}"
            except httpx.HTTPError as e:
                last = str(e)
            time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"{url} {params}: {last}")


def klines(http: Http, symbol: str, interval: str, n: int, futures: bool = False) -> dict | None:
    """Last `n` candles as numpy arrays {t, o, h, l, c, v} (t = open time, ms)."""
    url = f"{FAPI}/fapi/v1/klines" if futures else f"{SPOT}/api/v3/klines"
    page = 1500 if futures else 1000
    rows, end = [], None
    while len(rows) < n:
        p = {"symbol": symbol, "interval": interval, "limit": page}
        if end:
            p["endTime"] = end
        d = http.get(url, p)
        if not d:
            break
        rows = d + rows
        end = d[0][0] - 1
        if len(d) < page:
            break
    if not rows:
        return None
    rows = rows[-n:]
    a = np.array([[float(r[k]) for k in range(6)] for r in rows])
    return {"t": a[:, 0].astype(np.int64), "o": a[:, 1], "h": a[:, 2], "l": a[:, 3], "c": a[:, 4], "v": a[:, 5]}


def futures_data(http: Http, endpoint: str, symbol: str, since: int) -> list[dict]:
    """5m points of a /futures/data series newer than `since` (Binance keeps ~30 days).

    These endpoints ignore startTime when paginating forward, so walk back with endTime.
    """
    out, end = [], None
    while True:
        p = {"symbol": symbol, "period": "5m", "limit": 500}
        if end:
            p["endTime"] = end
        d = http.get(f"{FAPI}/futures/data/{endpoint}", p) or []
        d = [x for x in d if int(x["timestamp"]) > since and (not out or int(x["timestamp"]) < int(out[0]["timestamp"]))]
        if not d:
            break
        out = d + out
        end = int(d[0]["timestamp"]) - 1
    return out


def funding(http: Http, symbol: str, since: int) -> list[tuple[int, float]]:
    out, s = [], since
    while True:
        d = http.get(f"{FAPI}/fapi/v1/fundingRate", {"symbol": symbol, "limit": 1000, "startTime": s}) or []
        if not d:
            break
        out += [(int(x["fundingTime"]), float(x["fundingRate"]) * 100) for x in d]
        s = out[-1][0] + 1
        if len(d) < 1000:
            break
    return out
