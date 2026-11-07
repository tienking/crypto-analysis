"""MongoDB layout of the backtest database (default `ca_backtest`, env BACKTEST_DB).

Collections
- `market_5m`   one document per (symbol, UTC day): 288 five-minute slots per field.
                Binance keeps these series for only ~30 days, so we archive them.
- `weight_sets` every weight set ever used, per group; exactly one `active` per group.
- `runs`        one document per weekly backtest run (metrics, decision, reason).
- `state`       `{_id: "weights", locked: bool}`.

The pure helpers (slots, merging, picking the rollback target) are unit-tested; the
scripts use pymongo (sync), the web app uses Motor on the same collections.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

DB_NAME = os.getenv("BACKTEST_DB", "ca_backtest")
SLOT_MS = 5 * 60 * 1000
DAY_MS = 86_400_000
SLOTS = DAY_MS // SLOT_MS  # 288

# field -> (Binance endpoint under /futures/data, JSON key)
SERIES = {
    "oi": ("openInterestHist", "sumOpenInterest"),
    "oi_usd": ("openInterestHist", "sumOpenInterestValue"),
    "ls_global": ("globalLongShortAccountRatio", "longShortRatio"),
    "ls_top": ("topLongShortPositionRatio", "longShortRatio"),
    "taker_buy": ("takerlongshortRatio", "buyVol"),
    "taker_sell": ("takerlongshortRatio", "sellVol"),
}
GROUPS = {"short": ("5m", "15m", "30m", "1h"), "long": ("4h", "12h", "1d")}


def group_of(tf: str) -> str:
    return "short" if tf in GROUPS["short"] else "long"


def day_key(ts: int) -> str:
    return datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%d")


def day_start(ts: int) -> int:
    return ts - ts % DAY_MS


def merge_points(doc: dict | None, symbol: str, field: str, points: list[tuple[int, float]]) -> dict:
    """Put (ts, value) points of one UTC day into its bucket document (created if missing)."""
    if not points:
        raise ValueError("no points")
    start = day_start(points[0][0])
    doc = doc or {"_id": f"{symbol}:{day_key(start)}", "symbol": symbol, "day": day_key(start), "start": start}
    arr = list(doc.get(field) or [None] * SLOTS)
    for ts, v in points:
        if day_start(ts) != start:
            raise ValueError("points span more than one day")
        arr[(ts - start) // SLOT_MS] = v
    doc[field] = arr
    return doc


def series_from_docs(docs, field: str, step_ms: int = SLOT_MS) -> list[tuple[int, float]]:
    """[(ts, value)] of one field, oldest first, keeping only timestamps on a `step_ms` grid."""
    out = []
    for d in sorted(docs, key=lambda d: d["start"]):
        for i, v in enumerate(d.get(field) or []):
            ts = d["start"] + i * SLOT_MS
            if v is not None and ts % step_ms == 0:
                out.append((ts, float(v)))
    return out


def rollback_target(sets: list[dict]) -> dict | None:
    """The set to re-activate: the newest one created before the active one."""
    active = next((s for s in sets if s.get("active")), None)
    if active is None:
        return None
    older = [s for s in sets if s["created_at"] < active["created_at"]]
    return max(older, key=lambda s: s["created_at"]) if older else None


def sync_db():
    """pymongo database for the scripts (lazy import: the web app never needs it)."""
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv()
    return MongoClient(os.environ["MONGODB_URL"], serverSelectionTimeoutMS=20000)[DB_NAME]
