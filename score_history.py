"""Score history: every minute, the score of each Admin chart coin on every timeframe.

The recorder runs inside the web app (one uvicorn worker; SCORE_RECORDER=0 turns it off).
Scores use the default thresholds and the active backtest weights of each timeframe's group,
like a visitor who changed nothing. Storage: collection `score_history`, one document per
coin per UTC day: {_id: "BTCUSDT:2026-11-09", symbol, day, s: {tf: {minute of day: score}}}.
Days older than RETENTION_DAYS are deleted.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

from analysis.config import TIMEFRAMES, Thresholds, Weights
from analysis.service import analyze, normalize_symbol
from backtest.store import group_of

log = logging.getLogger("score_history")
RETENTION_DAYS = 90
MIN_MS, DAY_MS = 60_000, 86_400_000
# range -> (span, bucket): about 300-360 points per line whatever the range
RANGES = {"6h": (6 * 3_600_000, MIN_MS), "24h": (DAY_MS, 5 * MIN_MS), "7d": (7 * DAY_MS, 30 * MIN_MS),
          "30d": (30 * DAY_MS, 2 * 3_600_000), "90d": (90 * DAY_MS, 6 * 3_600_000)}


def symbols_of(coins: list[dict]) -> list[str]:
    """Admin chart pairs -> Binance symbols, unique, in order; invalid labels skipped."""
    out = []
    for c in coins:
        try:
            s = normalize_symbol(str(c.get("label", "")))
        except ValueError:
            continue
        if s not in out:
            out.append(s)
    return out


def day_id(symbol: str, ms: int) -> str:
    return f"{symbol}:{datetime.fromtimestamp(ms / 1000, timezone.utc):%Y-%m-%d}"


def update_doc(symbol: str, minute_ms: int, scores: dict) -> tuple[dict, dict]:
    """(filter, update) storing {tf: score} at that minute."""
    day = minute_ms - minute_ms % DAY_MS
    idx = (minute_ms - day) // MIN_MS
    sets = {f"s.{tf}.{idx}": v for tf, v in scores.items()}
    return ({"_id": day_id(symbol, minute_ms)},
            {"$set": {**sets, "symbol": symbol, "day": datetime.fromtimestamp(day / 1000, timezone.utc)}})


def aggregate(docs: list[dict], start: int, end: int, step: int, tfs=TIMEFRAMES) -> dict:
    """Mean score per bucket of `step` ms on [start, end), per timeframe; None = no data."""
    n = max(0, (end - start) // step)
    sums = {tf: [0.0] * n for tf in tfs}
    cnts = {tf: [0] * n for tf in tfs}
    for d in docs:
        day = int(d["day"].replace(tzinfo=timezone.utc).timestamp() * 1000) if isinstance(d["day"], datetime) else int(d["day"])
        for tf, slots in (d.get("s") or {}).items():
            if tf not in sums:
                continue
            for k, v in slots.items():
                if v is None:
                    continue
                t = day + int(k) * MIN_MS
                if start <= t < end:
                    b = (t - start) // step
                    if b < n:
                        sums[tf][b] += v
                        cnts[tf][b] += 1
    return {"t": [start + i * step for i in range(n)],
            "series": {tf: [round(sums[tf][i] / cnts[tf][i], 1) if cnts[tf][i] else None for i in range(n)]
                       for tf in tfs}}


async def record_once(col, client, coins: list[dict], active: dict, now_ms: int | None = None) -> dict:
    """Score every coin on every timeframe and store the minute. Returns {symbol: n scores}."""
    minute = (now_ms or int(time.time() * 1000)) // MIN_MS * MIN_MS
    t = Thresholds()
    weights = {g: Weights(**v["weights"]) for g, v in active.items()}
    done = {}
    for sym in symbols_of(coins):
        async def one(tf):
            try:
                d = await analyze(client, sym, tf, t, weights[group_of(tf)], with_bottoms=False)
                return tf, d["score"]
            except Exception:  # noqa: BLE001 — e.g. a pair not on Binance: skip it
                return tf, None
        res = dict(await asyncio.gather(*(one(tf) for tf in TIMEFRAMES)))
        scores = {tf: round(float(v), 1) for tf, v in res.items() if v is not None}
        if scores:
            await col.update_one(*update_doc(sym, minute, scores), upsert=True)
        done[sym] = len(scores)
    return done


async def history(col, symbol: str, rng: str, now_ms: int | None = None) -> dict:
    span, step = RANGES[rng]
    end = ((now_ms or int(time.time() * 1000)) // step + 1) * step
    start = end - span
    first_day = datetime.fromtimestamp((start - start % DAY_MS) / 1000, timezone.utc)
    docs = [d async for d in col.find({"symbol": symbol, "day": {"$gte": first_day}})]
    return {"symbol": symbol, "range": rng, "step": step, **aggregate(docs, start, end, step)}


async def recorder_loop(col, client, get_coins, get_active_weights):
    """Every minute (a few seconds after it starts, so 1m candles have closed), forever."""
    last_cleanup = 0.0
    while True:
        await asyncio.sleep(MIN_MS / 1000 - time.time() % 60 + 3)
        try:
            await record_once(col, client, await get_coins(), await get_active_weights())
            if time.time() - last_cleanup > 3600:
                cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS + 1)
                await col.delete_many({"day": {"$lt": cutoff}})
                last_cleanup = time.time()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — never let one bad minute stop the recorder
            log.warning("score recorder: %s", e)
