"""Daily job: archive Binance's 5m futures series (OI, long/short ratios, taker volume).

Binance keeps them ~30 days, so a run fetches only what is newer than what is stored;
after downtime of up to ~29 days the next run still fills the gap. Idempotent.

    python -m backtest.collect
"""
from __future__ import annotations

import time
from collections import defaultdict

from .binance_hist import COINS, Http, futures_data
from .store import SERIES, day_start, merge_points, sync_db


def latest_ts(col, symbol: str, field: str) -> int:
    """Newest stored timestamp of a field (0 when nothing is stored)."""
    for d in col.find({"symbol": symbol, field: {"$exists": True}}, {"start": 1, field: 1}).sort("start", -1).limit(3):
        idx = [i for i, v in enumerate(d[field]) if v is not None]
        if idx:
            return d["start"] + idx[-1] * 300_000
    return 0


def collect(db=None, http: Http | None = None, coins=COINS) -> dict:
    db = db if db is not None else sync_db()
    http = http or Http()
    col = db["market_5m"]
    added = {}
    by_endpoint = defaultdict(list)                      # endpoint -> [(field, key)]
    for field, (endpoint, key) in SERIES.items():
        by_endpoint[endpoint].append((field, key))
    for coin in coins:
        symbol = coin + "USDT"
        n = 0
        for endpoint, fields in by_endpoint.items():
            since = min(latest_ts(col, symbol, f) for f, _ in fields)
            rows = futures_data(http, endpoint, symbol, since)
            days = defaultdict(lambda: defaultdict(list))  # day start -> field -> points
            for r in rows:
                ts = int(r["timestamp"])
                for f, key in fields:
                    if r.get(key) is not None:
                        days[day_start(ts)][f].append((ts, float(r[key])))
            for start, per_field in days.items():
                doc = col.find_one({"symbol": symbol, "start": start})
                for f, pts in per_field.items():
                    doc = merge_points(doc, symbol, f, pts)
                col.replace_one({"_id": doc["_id"]}, doc, upsert=True)
            n += len(rows)
        added[symbol] = n
    col.create_index([("symbol", 1), ("start", 1)])
    return added


def main():
    t0 = time.time()
    added = collect()
    print(f"[collect] {sum(added.values())} points in {time.time() - t0:.0f}s: {added}", flush=True)


if __name__ == "__main__":
    main()
