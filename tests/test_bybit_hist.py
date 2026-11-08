"""backtest.bybit_hist against a fake Bybit (no network)."""
import pytest

from backtest import bybit_hist as bh

H1 = bh.STEP["1h"]


class FakeBybit:
    """Serves a 1h kline / OI series and 8h funding on [t0, t1), newest first like Bybit."""

    def __init__(self, t0, t1, listed=True):
        self.t0, self.t1, self.listed, self.calls = t0, t1, listed, 0

    def get(self, url, p):
        self.calls += 1
        ep = url.rsplit("/market/", 1)[1]
        if not self.listed:
            return {"retCode": 10001, "retMsg": "params error: symbol invalid"}
        if ep == "kline":
            step = bh.STEP[{v: k for k, v in bh.KLINE.items()}[p["interval"]]]
            ts = [t for t in range(self.t0, self.t1, step) if p["start"] <= t <= p["end"]][::-1][:p["limit"]]
            lst = [[str(t), "1", "2", "0.5", str(100 + t // step % 7), "10", "1000"] for t in ts]
        elif ep == "open-interest":
            step = bh.STEP[{v: k for k, v in bh.OI_INTERVAL.items()}[p["intervalTime"]]]
            ts = [t for t in range(self.t0, self.t1, step) if p["startTime"] <= t <= p["endTime"]][::-1][:p["limit"]]
            lst = [{"timestamp": str(t), "openInterest": "5"} for t in ts]
        else:
            ts = [t for t in range(self.t0, self.t1, 8 * H1) if p["startTime"] <= t <= p["endTime"]][::-1][:p["limit"]]
            lst = [{"fundingRateTimestamp": str(t), "fundingRate": "0.0001"} for t in ts]
        return {"retCode": 0, "result": {"list": lst}}


def test_klines_pages_back_and_drops_the_forming_candle():
    t0 = 1_700_000_000_000 // H1 * H1
    now = t0 + 2500 * H1 + H1 // 2                 # inside candle 2500 (still forming)
    k = bh.klines(FakeBybit(t0, t0 + 2501 * H1), "BTCUSDT", "1h", t0, now)
    assert len(k["t"]) == 2500 and k["t"][0] == t0 and k["t"][-1] == t0 + 2499 * H1
    assert list(k["t"]) == sorted(k["t"])


def test_open_interest_and_funding_page_back_to_the_start():
    t0 = 1_700_000_000_000 // H1 * H1
    http = FakeBybit(t0, t0 + 1000 * H1)
    oi = bh.open_interest(http, "BTCUSDT", "1h", t0 + 10 * H1, t0 + 1000 * H1)
    assert len(oi) == 990 and oi[0][0] == t0 + 10 * H1 and oi[-1][1] == 5.0
    f = bh.funding(http, "BTCUSDT", t0, t0 + 1000 * H1)
    assert len(f) == 125 and f[0] == (t0, pytest.approx(0.01))      # rate in %


def test_unknown_symbol_gives_none():
    assert bh.load_coin(FakeBybit(0, H1, listed=False), "NOPE", ["4h"], {"4h": "1h"}, 10 * H1, 100, 50) is None


def test_other_errors_raise():
    class Down:
        def get(self, url, p):
            return {"retCode": 10003, "retMsg": "Invalid api key"}
    with pytest.raises(RuntimeError):
        bh.klines(Down(), "BTCUSDT", "1h", 0, H1)


def test_starts_cover_the_liquidation_period_and_respect_the_floor():
    now = bh.FLOOR + 3000 * 86_400_000
    s = bh.starts(["4h", "12h"], {"4h": "1h", "12h": "2h"}, now, 1000, 350)
    assert s["4h"] == now - 1350 * bh.STEP["4h"]
    assert s["1h"] == s["4h"] - 520 * H1 and s["2h"] == s["12h"] - 520 * bh.STEP["2h"]
    assert bh.starts(["1d"], {"1d": "4h"}, now, 15000, 350)["1d"] == bh.FLOOR


def test_load_coin_shapes_engine_input():
    t0 = 1_700_000_000_000 // (12 * H1) * (12 * H1)
    now = t0 + 3000 * H1
    d = bh.load_coin(FakeBybit(t0, now), "BTC", ["4h", "12h"], {"4h": "1h", "12h": "2h"}, now, 100, 50)
    assert set(d["fut"]) == {"1h", "2h", "4h", "12h"} and set(d["oi"]) == set(d["fut"])
    assert all(t % bh.STEP["2h"] == 0 for t, *_ in d["oi"]["2h"])       # thinned from 1h
    assert all(t % bh.STEP["12h"] == 0 for t, *_ in d["oi"]["12h"])     # thinned from 4h
    ts, oi, usd = d["oi"]["4h"][0]
    close = dict(zip(d["fut"]["4h"]["t"].tolist(), d["fut"]["4h"]["c"].tolist()))[ts]
    assert oi == 5.0 and usd == pytest.approx(5.0 * close)
    assert d["funding"] and d["funding"][0][1] == pytest.approx(0.01)


def test_transient_errors_are_retried(monkeypatch):
    monkeypatch.setattr(bh.time, "sleep", lambda s: None)
    t0 = 1_700_000_000_000 // H1 * H1
    real = FakeBybit(t0, t0 + 10 * H1)
    answers = [{"retCode": 10016, "retMsg": "svc error: Get kline failed"}, {"retCode": 10006, "retMsg": "Too many visits"}]

    class Flaky:
        def get(self, url, p):
            return answers.pop(0) if answers else real.get(url, p)
    k = bh.klines(Flaky(), "BTCUSDT", "1h", t0, t0 + 10 * H1)
    assert len(k["t"]) == 10 and not answers


def test_a_persistent_transient_error_still_raises(monkeypatch):
    monkeypatch.setattr(bh.time, "sleep", lambda s: None)

    class Down:
        def get(self, url, p):
            return {"retCode": 10016, "retMsg": "svc error"}
    with pytest.raises(RuntimeError):
        bh.klines(Down(), "BTCUSDT", "1h", 0, H1)
