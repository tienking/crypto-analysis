"""Async Binance public market-data client with fallbacks and a tiny TTL cache."""
from __future__ import annotations

import time

import httpx

from .config import CACHE_TTL_SECONDS

SPOT_HOSTS = ("https://data-api.binance.vision", "https://api.binance.com")
FAPI = "https://fapi.binance.com"


class SymbolNotFound(Exception):
    pass


class UpstreamError(Exception):
    pass


class BinanceClient:
    def __init__(self, client: httpx.AsyncClient, ttl: float = CACHE_TTL_SECONDS):
        self.client = client
        self.ttl = ttl
        self._cache: dict[str, tuple[float, object]] = {}

    async def _get(self, url: str, params: dict):
        key = url + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
        hit = self._cache.get(key)
        if hit and time.monotonic() - hit[0] < self.ttl:
            return hit[1]
        r = await self.client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
        self._cache[key] = (time.monotonic(), data)
        if len(self._cache) > 500:
            self._cache.clear()
        return data

    async def klines(self, symbol: str, interval: str, limit: int = 400) -> tuple[list, str]:
        """Spot first (two hosts), then USDⓈ-M futures. Returns (rows, source)."""
        params = {"symbol": symbol, "interval": interval, "limit": limit}
        not_found = 0
        attempts = [(f"{h}/api/v3/klines", "Spot") for h in SPOT_HOSTS] + [(f"{FAPI}/fapi/v1/klines", "Futures")]
        last_err: Exception | None = None
        for url, src in attempts:
            try:
                return await self._get(url, params), src
            except httpx.HTTPStatusError as e:
                last_err = e
                if e.response.status_code == 400:
                    not_found += 1
            except httpx.HTTPError as e:
                last_err = e
        if not_found:
            raise SymbolNotFound(symbol)
        raise UpstreamError(str(last_err))

    async def funding(self, symbol: str) -> float | None:
        """Last funding rate in % (per 8h)."""
        try:
            d = await self._get(f"{FAPI}/fapi/v1/premiumIndex", {"symbol": symbol})
            return float(d["lastFundingRate"]) * 100
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            return None

    async def oi_change(self, symbol: str, period: str, lookback: int) -> float | None:
        """% change of open interest value over `lookback` periods."""
        try:
            d = await self._get(f"{FAPI}/futures/data/openInterestHist",
                                {"symbol": symbol, "period": period, "limit": min(lookback + 1, 500)})
            if len(d) < 2:
                return None
            first, last = float(d[0]["sumOpenInterestValue"]), float(d[-1]["sumOpenInterestValue"])
            return (last / first - 1) * 100 if first > 0 else None
        except (httpx.HTTPError, KeyError, TypeError, ValueError, IndexError):
            return None
