"""Orchestrates data fetching and scoring for one symbol/timeframe."""
from __future__ import annotations

import asyncio
import math
import re
from datetime import datetime, timezone

from .binance import BinanceClient
from .config import BTC_SYMBOL, CHART_CANDLES, HIGHER_TF, QUOTE, Thresholds, Weights
from .criteria import Candles, Context, score


def normalize_symbol(raw: str) -> str:
    s = re.sub(r"[^A-Z0-9]", "", (raw or "").upper())
    if s.endswith(QUOTE):
        s = s[: -len(QUOTE)]
    if len(s) < 2:
        raise ValueError("Mã coin cần ít nhất 2 ký tự.")
    return s + QUOTE


def _clean(arr) -> list:
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else round(float(v), 10) for v in arr]


async def analyze(client: BinanceClient, raw_symbol: str, tf: str,
                  thresholds: Thresholds, weights: Weights) -> dict:
    symbol = normalize_symbol(raw_symbol)
    is_btc = symbol == BTC_SYMBOL
    limit = min(1000, max(300, thresholds.ema_slow + 150))

    rows, source = await client.klines(symbol, tf, limit)   # raises SymbolNotFound early
    if len(rows) < 60:
        raise ValueError(f"{symbol} có quá ít nến ở khung {tf} để tính chỉ báo.")

    async def safe(coro):
        try:
            return await coro
        except Exception:  # noqa: BLE001 — optional data must never break the analysis
            return None

    htf_task = safe(client.klines(symbol, HIGHER_TF[tf], limit))
    btc_task = safe(client.klines(BTC_SYMBOL, tf, limit)) if not is_btc else asyncio.sleep(0, None)
    fund_task = client.funding(symbol)
    oi_task = client.oi_change(symbol, tf, thresholds.vol_lookback)
    htf, btc, funding, oi = await asyncio.gather(htf_task, btc_task, fund_task, oi_task)

    candles = Candles.from_klines(rows)
    ctx = Context(
        c=candles, t=thresholds,
        htf=Candles.from_klines(htf[0]) if htf and len(htf[0]) > 0 else None,
        btc=Candles.from_klines(btc[0]) if btc and len(btc[0]) > 0 else None,
        is_btc=is_btc, funding=funding, oi_change=oi,
    )
    result = score(ctx, weights)

    n = min(CHART_CANDLES, len(candles))
    sl = slice(-n, None)
    return {
        "symbol": symbol,
        "timeframe": tf,
        "higher_timeframe": HIGHER_TF[tf],
        "source": source,
        "price": float(candles.close[-1]),
        "price_change_pct": round(ctx.price_change, 3),
        "indicators": {
            "ema_fast": _clean([ctx.ema_fast[-1]])[0],
            "ema_slow": _clean([ctx.ema_slow[-1]])[0],
            "rsi": _clean([ctx.rsi[-1]])[0],
            "macd_hist": _clean([ctx.hist[-1]])[0],
            "adx": _clean([ctx.adx[-1]])[0],
            "funding_pct": funding,
            "oi_change_pct": oi,
        },
        **result,
        "chart": {
            "time": candles.time[sl].tolist(),
            "open": _clean(candles.open[sl]), "high": _clean(candles.high[sl]),
            "low": _clean(candles.low[sl]), "close": _clean(candles.close[sl]),
            "ema_fast": _clean(ctx.ema_fast[sl]), "ema_slow": _clean(ctx.ema_slow[sl]),
        },
        "thresholds": thresholds.model_dump(),
        "weights": weights.model_dump(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
