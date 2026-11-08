"""Download cache for the weekly run: time series stored in `ca_backtest.cache`, so a run only
fetches what is new since the last one.

One document per series, `_id` = "<source>:<kind>:<symbol>:<tf>":
{covered_from, updated_at, n, cols: {name: zlib(numpy bytes)}, dtypes: {name: str}}.
`covered_from` is the earliest time the stored series was asked to cover (a coin listed later
simply has no older rows), so a series is downloaded in full only the first time, or when a
run asks for older data than stored. Only closed candles / settled points are stored. Any
cache error falls back to a full download: the cache can never fail a run.
"""
from __future__ import annotations

import zlib
from datetime import datetime, timezone
from typing import Callable

import numpy as np

COLLECTION = "cache"
Series = dict  # {"t": int64 array, other columns: arrays of the same length}


def encode(s: Series) -> dict:
    return {"cols": {k: zlib.compress(np.ascontiguousarray(v).tobytes(), 6) for k, v in s.items()},
            "dtypes": {k: str(v.dtype) for k, v in s.items()}, "n": int(len(s["t"]))}


def decode(doc: dict) -> Series:
    return {k: np.frombuffer(zlib.decompress(b), dtype=doc["dtypes"][k]).copy() for k, b in doc["cols"].items()}


def _slice(s: Series, mask) -> Series:
    return {k: v[mask] for k, v in s.items()}


def merge(old: Series | None, new: Series | None) -> Series | None:
    """Old rows, then new rows strictly after the last old one."""
    if not old or not len(old["t"]):
        return new
    if not new or not len(new["t"]):
        return old
    new = _slice(new, new["t"] > old["t"][-1])
    return {k: np.concatenate([old[k], new[k]]) for k in old}


def series(db, key: str, start: int, end: int, fetch: Callable[[int, int], Series | None]) -> Series | None:
    """The series on [start, end), from the cache plus a fetch of what is missing.
    `fetch(a, b)` returns the closed rows with a <= t < b (or None)."""
    col = db[COLLECTION] if db is not None else None
    doc = None
    if col is not None:
        try:
            doc = col.find_one({"_id": key})
        except Exception:  # noqa: BLE001
            col = None
    old = decode(doc) if doc and doc.get("covered_from", end) <= start else None
    if old is not None and len(old["t"]):
        out = merge(old, fetch(int(old["t"][-1]) + 1, end))
    else:
        out = fetch(start, end)
    if out is None or not len(out["t"]):
        return None
    out = _slice(out, out["t"] >= start)
    if col is not None:
        try:
            col.replace_one({"_id": key}, {"_id": key, "covered_from": start, **encode(out),
                                           "updated_at": datetime.now(timezone.utc)}, upsert=True)
        except Exception:  # noqa: BLE001
            pass
    return out


def points(s: Series | None) -> list[tuple[int, float]]:
    return [] if s is None else list(zip(s["t"].tolist(), s["v"].tolist()))


def from_points(p: list[tuple[int, float]]) -> Series | None:
    if not p:
        return None
    return {"t": np.array([x[0] for x in p], dtype=np.int64), "v": np.array([x[1] for x in p], dtype=np.float64)}
