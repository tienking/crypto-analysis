"""Score history: recorder, storage layout, aggregation and the /scores route (no network, no MongoDB)."""
import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGODB_URL", "mongodb://localhost:1")
os.environ.setdefault("JWT_SECRET", "test-secret")

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api
import score_history as sh
from analysis.config import TIMEFRAMES, Weights

DAY = 1_794_096_000_000                     # a UTC midnight
W = {"short": {"weights": Weights().model_dump()}, "long": {"weights": Weights().model_dump()}}


class Col:
    """Enough of a Motor collection: $set with dotted paths, find by symbol + day."""

    def __init__(self):
        self.docs = {}

    async def update_one(self, q, u, upsert=False):
        d = self.docs.setdefault(q["_id"], {"_id": q["_id"]})
        for path, v in u["$set"].items():
            cur, *rest = path.split(".")
            if not rest:
                d[cur] = v
                continue
            node = d.setdefault(cur, {})
            for p in rest[:-1]:
                node = node.setdefault(p, {})
            node[rest[-1]] = v

    def find(self, q):
        docs = [d for d in self.docs.values() if d["symbol"] == q["symbol"] and d["day"] >= q["day"]["$gte"]]

        async def gen():
            for d in docs:
                yield d
        return gen()


def test_symbols_of_admin_pairs():
    coins = [{"label": "BTCUSDT"}, {"label": "eth"}, {"label": "BTCUSDT"}, {"label": "x"}, {}]
    assert sh.symbols_of(coins) == ["BTCUSDT", "ETHUSDT"]


def test_update_doc_puts_the_minute_in_its_day():
    f, u = sh.update_doc("BTCUSDT", DAY + 61 * 60_000 + 5_000, {"4h": 12.5})
    assert f == {"_id": "BTCUSDT:" + datetime.fromtimestamp(DAY / 1000, timezone.utc).strftime("%Y-%m-%d")}
    assert u["$set"]["s.4h.61"] == 12.5 and u["$set"]["day"] == datetime.fromtimestamp(DAY / 1000, timezone.utc)


def test_aggregate_means_per_bucket_and_leaves_gaps():
    doc = {"day": datetime.fromtimestamp(DAY / 1000, timezone.utc).replace(tzinfo=None),
           "s": {"1h": {"0": 10, "1": 20, "2": 30, "7": -40}, "zz": {"0": 1}}}
    out = sh.aggregate([doc], DAY, DAY + 10 * 60_000, 5 * 60_000)
    assert out["t"] == [DAY, DAY + 5 * 60_000]
    assert out["series"]["1h"] == [20.0, -40.0]
    assert out["series"]["4h"] == [None, None] and "zz" not in out["series"]


def test_record_once_scores_every_timeframe_and_skips_failures(monkeypatch):
    seen = []

    async def fake_analyze(client, sym, tf, t, w, with_bottoms=True):
        seen.append((sym, tf, with_bottoms))
        if sym == "NOPEUSDT":
            raise ValueError("not on Binance")
        return {"score": 33.333 if tf != "1d" else -5}
    monkeypatch.setattr(sh, "analyze", fake_analyze)
    col = Col()
    done = asyncio.run(sh.record_once(col, None, [{"label": "BTCUSDT"}, {"label": "NOPE"}], W, DAY + 90_000))
    assert done == {"BTCUSDT": len(TIMEFRAMES), "NOPEUSDT": 0}
    assert all(b is False for *_, b in seen)                      # bottoms skipped
    doc = col.docs[sh.day_id("BTCUSDT", DAY)]
    assert doc["s"]["4h"] == {"1": 33.3} and doc["s"]["1d"] == {"1": -5.0}
    assert sh.day_id("NOPEUSDT", DAY) not in col.docs


def test_scores_route(monkeypatch):
    col = Col()
    asyncio.run(col.update_one(*sh.update_doc("BTCUSDT", DAY + 60_000, {"4h": 40.0}), upsert=True))
    monkeypatch.setattr(api, "score_col", col)

    async def coins():
        return [{"label": "BTCUSDT"}]
    monkeypatch.setattr(api, "get_coins", coins)
    monkeypatch.setattr(sh.time, "time", lambda: (DAY + 3 * 3_600_000) / 1000)
    api._history_cache.clear()
    app = FastAPI()
    app.include_router(api.router)
    c = TestClient(app)
    r = c.get("/api/crypto-analysis/scores", params={"symbol": "btc", "range": "6h"}).json()
    assert r["recorded"] is True and r["step"] == 60_000 and len(r["t"]) == 360
    assert 40.0 in r["series"]["4h"] and set(r["series"]) == set(TIMEFRAMES)
    other = c.get("/api/crypto-analysis/scores", params={"symbol": "DOGE", "range": "24h"}).json()
    assert other["recorded"] is False and all(v is None for v in other["series"]["4h"])
    assert c.get("/api/crypto-analysis/scores", params={"symbol": "BTC", "range": "1y"}).status_code == 422
