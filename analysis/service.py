"""Orchestrates data fetching and scoring for one symbol/timeframe."""
from __future__ import annotations

import asyncio
import math
import re
from datetime import datetime, timezone

from .binance import BinanceClient
from .config import BTC_SYMBOL, CHART_CANDLES, HIGHER_TF, LIQ_PERIOD, QUOTE, Thresholds, Weights
from .criteria import Candles, Context, score
from .liquidation import liquidation_map, pull


def normalize_symbol(raw: str) -> str:
    s = re.sub(r"[^A-Z0-9]", "", (raw or "").upper())
    if s.endswith(QUOTE):
        s = s[: -len(QUOTE)]
    if len(s) < 2:
        raise ValueError("Mã coin cần ít nhất 2 ký tự.")
    return s + QUOTE


def _liq_map(oi_hist, krows, t: Thresholds) -> dict | None:
    """Align OI points with futures candles by open time, then build the liquidation map.

    The map is centred on the futures price (the levels come from futures candles). Candles
    newer than the last OI point carry the last OI forward, so the live candle still sweeps.
    """
    if not oi_hist or not krows:
        return None
    oi_at = dict(oi_hist)
    first = next((i for i, r in enumerate(krows) if int(r[0]) in oi_at), None)
    if first is None:
        return None
    oi, last = [], None
    for r in krows[first:]:
        last = oi_at.get(int(r[0]), last)
        oi.append(last)
    if len(oi) < 50:
        return None
    rows = krows[first:]
    high, low, close = ([float(r[k]) for r in rows] for k in (2, 3, 4))
    return liquidation_map(oi, high, low, close, close[-1], t.liq_range_pct)


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
    oih_task = client.oi_history(symbol, LIQ_PERIOD[tf])
    fk_task = client.futures_klines(symbol, LIQ_PERIOD[tf])
    htf, btc, funding, oi, oi_hist, fk = await asyncio.gather(htf_task, btc_task, fund_task, oi_task, oih_task, fk_task)

    candles = Candles.from_klines(rows)
    try:
        liq = _liq_map(oi_hist, fk, thresholds)
    except Exception:  # noqa: BLE001 — optional, like the other futures data
        liq = None
    if liq is not None:
        up, down, top_s, top_l = pull(liq)
        top = lambda x: None if x is None else {"price": x[0], "usd": x[1], "dist_pct": (x[0] / liq["price"] - 1) * 100}  # noqa: E731
        liq.update(period=LIQ_PERIOD[tf], pull_up=(up / (up + down) if up + down else None),
                   top_short=top(top_s), top_long=top(top_l))
    ctx = Context(
        c=candles, t=thresholds,
        htf=Candles.from_klines(htf[0]) if htf and len(htf[0]) > 0 else None,
        btc=Candles.from_klines(btc[0]) if btc and len(btc[0]) > 0 else None,
        is_btc=is_btc, funding=funding, oi_change=oi, liq=liq,
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
        "liquidation": liq,
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
