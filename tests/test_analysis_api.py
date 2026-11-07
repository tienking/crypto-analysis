"""Analysis + chat routes with a fake Binance client and a fake AI (no network, no MongoDB)."""
import os

os.environ.setdefault("MONGODB_URL", "mongodb://localhost:1")  # never contacted: Motor connects lazily
os.environ.setdefault("JWT_SECRET", "test-secret")

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api
from analysis.binance import SymbolNotFound, UpstreamError
from analysis.config import Thresholds, Weights
from analysis.criteria import Candles, Context, score

URL = "/api/crypto-analysis/analysis"


def make_klines(trend: float, n: int = 400, seed: int = 1):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(trend + rng.normal(0, 0.004, n)))
    rows, prev = [], close[0]
    for i, c in enumerate(close):
        o = prev
        hi, lo = max(o, c) * 1.002, min(o, c) * 0.998
        vol = 1000 * (1.6 if (c >= o) == (trend > 0) else 1.0)
        rows.append([i * 3_600_000, str(o), str(hi), str(lo), str(c), str(vol), 0, "0", 0, "0", "0", "0"])
        prev = c
    return rows


class FakeBinance:
    def __init__(self, trend, down=False, futures=True):
        self.trend, self.down, self.futures = trend, down, futures

    async def klines(self, symbol, interval, limit=400):
        if self.down:
            raise UpstreamError("down")
        if symbol == "NOPEUSDT":
            raise SymbolNotFound(symbol)
        return make_klines(self.trend, limit), "Spot"

    async def funding(self, symbol):
        return 0.01

    async def oi_change(self, symbol, period, lookback):
        return 5.0

    async def oi_history(self, symbol, period, limit=500):
        if not self.futures:
            return None
        return [(i * 3_600_000, 1000.0 + 5 * i) for i in range(limit)]   # OI keeps rising

    async def futures_klines(self, symbol, interval, limit=500):
        return make_klines(self.trend, limit) if self.futures else None


AUTO = {
    "short": {"weights": Weights(htf=0, trend=100, structure=0, momentum=0, volume=0, derivatives=0, btc=0,
                                 liquidation=0).model_dump(), "updated_at": None, "source": "backtest"},
    "long": {"weights": Weights().model_dump(), "updated_at": None, "source": "default"},
}


@pytest.fixture(autouse=True)
def fake_weights(monkeypatch):
    async def active(force=False):
        return AUTO
    monkeypatch.setattr(api, "get_active_weights", active)


@pytest.fixture
def client():
    api._analysis_hits.clear()
    app = FastAPI()
    app.include_router(api.router)

    def make(trend=0.004, down=False, futures=True):
        app.state.binance = FakeBinance(trend, down, futures)
        return TestClient(app)
    return make


def test_uptrend_scores_positive(client):
    r = client(0.004).post(URL, json={"symbol": "sol", "timeframe": "1h"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["symbol"] == "SOLUSDT" and d["score"] > 20
    assert len(d["criteria"]) == 8 and len(d["chart"]["close"]) == 120
    liq = d["liquidation"]
    assert liq and liq["period"] == "1h" and len(liq["bins"]) == 40
    # swept levels are gone: longs only wait below the price, shorts only above
    p, half_bin = liq["price"], liq["price"] * liq["bin_pct"] / 200   # the middle bins straddle p
    assert any(b["long"] > 0 for b in liq["bins"])
    assert all(b["long"] == 0 for b in liq["bins"] if b["price"] - half_bin > p)
    assert all(b["short"] == 0 for b in liq["bins"] if b["price"] + half_bin < p)


def test_bottoms_in_the_response_and_the_chat_context(client):
    d = client(-0.004).post(URL, json={"symbol": "ETH", "timeframe": "1h"}).json()
    b = d["bottoms"]
    assert b["short"]["tf"] == "4h" and b["mid"]["tf"] == "1d"
    assert b["short"]["at_low"] and b["short"]["rate"] is not None
    assert b["cycle"]["available"] == 5 and len(b["cycle"]["conditions"]) == 5
    ctx = api._analysis_context(d)
    assert "Đáy ngắn hạn" in ctx and "Cycle-bottom checklist" in ctx


def test_bottoms_fail_soft(client, monkeypatch):
    import analysis.service as svc
    monkeypatch.setattr(svc, "cycle_view", lambda w: 1 / 0)
    d = client(0.004).post(URL, json={"symbol": "SOL", "timeframe": "1h"}).json()
    assert d["bottoms"]["cycle"] is None and d["bottoms"]["short"] is not None


def test_no_futures_marks_liquidation_na(client):
    d = client(0.004, futures=False).post(URL, json={"symbol": "sol", "timeframe": "1h"}).json()
    assert d["liquidation"] is None
    assert next(c for c in d["criteria"] if c["id"] == "liquidation")["status"] == "na"


def test_downtrend_scores_negative(client):
    assert client(-0.004).post(URL, json={"symbol": "ETH", "timeframe": "4h"}).json()["score"] < -20


@pytest.mark.parametrize("tf,higher,liq_period", [("5m", "30m", "5m"), ("30m", "2h", "30m"), ("12h", "3d", "2h")])
def test_new_timeframes(client, tf, higher, liq_period):
    d = client(0.004).post(URL, json={"symbol": "SOL", "timeframe": tf}).json()
    assert d["timeframe"] == tf and d["higher_timeframe"] == higher
    assert d["liquidation"]["period"] == liq_period


def test_unknown_timeframe_rejected(client):
    assert client(0.004).post(URL, json={"symbol": "SOL", "timeframe": "2h"}).status_code == 422


def test_btc_context_is_na_for_btc(client):
    d = client(0.004).post(URL, json={"symbol": "BTCUSDT"}).json()
    btc = next(x for x in d["criteria"] if x["id"] == "btc")
    assert btc["status"] == "na" and btc["points"] is None


def test_unknown_symbol_404(client):
    r = client().post(URL, json={"symbol": "NOPE"})
    assert r.status_code == 404 and "NOPEUSDT" in r.json()["detail"]


def test_binance_down_502(client):
    assert client(down=True).post(URL, json={"symbol": "BTC"}).status_code == 502


def test_invalid_overrides_422(client):
    assert client().post(URL, json={"symbol": "BTC", "timeframe": "3h"}).status_code == 422
    assert client().post(URL, json={"symbol": "BTC", "thresholds": {"ema_fast": 1}}).status_code == 422


def test_weight_override_changes_score():
    ctx = Context(c=Candles.from_klines(make_klines(0.004)), t=Thresholds(), funding=0.01, oi_change=-10.0, is_btc=True)
    base = score(ctx, Weights())["score"]
    only_trend = score(ctx, Weights(htf=0, trend=100, structure=0, momentum=0, volume=0, derivatives=0, btc=0, liquidation=0))["score"]
    assert only_trend == 100.0 and base <= 100.0


def test_config_endpoint(client):
    d = client().get(URL + "/config").json()
    assert set(d["weights"]) == {"htf", "trend", "structure", "momentum", "volume", "derivatives", "btc", "liquidation"}
    assert sum(d["weights"].values()) == 100
    assert d["weight_sets"]["short"]["trend"] == 100 and set(d["weight_groups"]) == {"short", "long"}


def test_auto_weights_follow_the_timeframe_group(client):
    c = client(0.004)
    short = c.post(URL, json={"symbol": "SOL", "timeframe": "1h"}).json()
    assert short["weights"]["trend"] == 100 and short["weights_info"] == {
        "source": "auto", "group": "short", "updated_at": None, "origin": "backtest"}
    assert {x["id"]: x["weight"] for x in short["criteria"]}["htf"] == 0
    long_ = c.post(URL, json={"symbol": "SOL", "timeframe": "4h"}).json()
    assert long_["weights"] == Weights().model_dump() and long_["weights_info"]["group"] == "long"


def test_custom_weights_win(client):
    w = Weights(htf=1, trend=1, structure=1, momentum=1, volume=1, derivatives=1, btc=1, liquidation=1).model_dump()
    d = client(0.004).post(URL, json={"symbol": "SOL", "timeframe": "1h", "weights": w}).json()
    assert d["weights"] == w and d["weights_info"] == {"source": "custom"}


def test_short_timeframes_warn_that_there_is_no_edge(client):
    c = client(0.004)
    assert any("backtest" in w for w in c.post(URL, json={"symbol": "SOL", "timeframe": "15m"}).json()["warnings"])
    assert not any("backtest" in w for w in c.post(URL, json={"symbol": "SOL", "timeframe": "1h"}).json()["warnings"])


def test_rate_limit(client):
    c = client()
    codes = [c.post(URL, json={"symbol": "SOL"}).status_code for _ in range(api._ANALYSIS_LIMIT + 1)]
    assert codes[:-1] == [200] * api._ANALYSIS_LIMIT and codes[-1] == 429


def test_chat_gets_the_analysis_as_context(client, monkeypatch):
    seen = {}

    async def fake_ai(system, conversation):
        seen["system"], seen["conversation"] = system, conversation
        return "ok", "fake"
    monkeypatch.setattr(api, "ai_chat", fake_ai)
    r = client(0.004).post("/api/crypto-analysis/chat", json={
        "message": "Vì sao điểm cao?", "analysis": {"symbol": "SOL", "timeframe": "1h"}})
    assert r.json() == {"reply": "ok", "provider": "fake"}
    assert "=== ANALYSIS ON SCREEN ===" in seen["system"] and "SOLUSDT" in seen["system"]
    assert seen["system"].count("\n- ") == 8  # one line per criterion
    assert seen["conversation"][-1] == {"role": "user", "content": "Vì sao điểm cao?"}


def test_chat_without_analysis_or_with_a_bad_coin(client, monkeypatch):
    systems = []

    async def fake_ai(system, conversation):
        systems.append(system)
        return "ok", "fake"
    monkeypatch.setattr(api, "ai_chat", fake_ai)
    c = client()
    assert c.post("/api/crypto-analysis/chat", json={"message": "hi"}).status_code == 200
    assert c.post("/api/crypto-analysis/chat", json={"message": "hi", "analysis": {"symbol": "NOPE"}}).status_code == 200
    assert "ANALYSIS ON SCREEN" not in systems[0]
    assert "could not be loaded" in systems[1]
