"""Replay the app's own criteria candle by candle, using only data known at each close.

- price criteria: window = last W closed candles (the app fetches ~350); the higher
  timeframe = its closed candles + the still-forming one rebuilt from the lower candles
  (the app sees that partial candle live); BTC = BTC candles up to the same time.
- derivatives / liquidation: OI (from the archive) at the candle close, the last settled
  funding rate, and the liquidation map from the last 500 OI points.
Rows sit on an absolute grid (every H-th candle since 1970) so price and derivative rows
of the same candle can be joined. Target: log return over the next H candles divided by recent volatility × √H (z), so coins
and timeframes can be pooled. One row per evaluation point: criterion -> score.
"""
from __future__ import annotations

import bisect
import multiprocessing as mp

import numpy as np

from analysis.config import HIGHER_TF, LIQ_PERIOD, Thresholds
from analysis.criteria import (Candles, Context, crit_btc, crit_derivatives, crit_htf, crit_liquidation,
                               crit_momentum, crit_structure, crit_trend, crit_volume)
from analysis.service import _liq_map

W, H = 350, 5
PRICE_CRITS = {"htf": crit_htf, "trend": crit_trend, "structure": crit_structure,
               "momentum": crit_momentum, "volume": crit_volume, "btc": crit_btc}
T = Thresholds()
_DATA: dict = {}   # set before forking workers (inherited, not pickled)


def _candles(a, s, e, extra=None):
    cols = [a[k][s:e] for k in ("o", "h", "l", "c", "v", "t")]
    if extra:
        cols = [np.append(x, y) for x, y in zip(cols, extra)]
    return Candles(*cols)


def _z(close, i, lr):
    vol = lr[max(0, i - 100):i].std()
    if not vol or i + H >= len(close):
        return None, None
    ret = close[i + H] / close[i] - 1
    return ret, float(np.log1p(ret) / (vol * np.sqrt(H)))


def price_rows(coin: str, tf: str) -> list[dict]:
    spot = _DATA["spot"]
    a, hx = spot[coin].get(tf), spot[coin].get(HIGHER_TF[tf])
    if a is None or hx is None or len(a["c"]) < W + H + 1:
        return []
    btc = None if coin == "BTC" else spot["BTC"].get(tf)
    dt = a["t"][1] - a["t"][0]
    lr = np.diff(np.log(a["c"]))
    out = []
    for i in range(W - 1, len(a["c"]) - H):
        ti = a["t"][i]
        if (ti // dt) % H:                       # absolute grid, shared with deriv_rows
            continue
        k = bisect.bisect_right(hx["t"], ti) - 1
        if k < 1:
            continue
        if k + 1 < len(hx["t"]) and hx["t"][k + 1] == ti + dt:       # higher candle closes with this one
            htf = _candles(hx, max(0, k + 1 - W), k + 1)
        else:
            j0 = bisect.bisect_left(a["t"], hx["t"][k])
            seg = slice(j0, i + 1)
            part = (a["o"][j0], a["h"][seg].max(), a["l"][seg].min(), a["c"][i], a["v"][seg].sum(), hx["t"][k])
            htf = _candles(hx, max(0, k - W + 1), k, extra=part)
        b = None
        if btc is not None:
            j = bisect.bisect_right(btc["t"], ti) - 1
            if j >= W - 1 and btc["t"][j] == ti:
                b = _candles(btc, j - W + 1, j + 1)
        ret, z = _z(a["c"], i, lr)
        if z is None:
            continue
        ctx = Context(c=_candles(a, i - W + 1, i + 1), t=T, htf=htf, btc=b, is_btc=coin == "BTC")
        row = {"coin": coin, "tf": tf, "t": int(ti), "ret": ret, "z": z}
        for cid, fn in PRICE_CRITS.items():
            row[cid] = None if (cid == "btc" and coin != "BTC" and b is None) else fn(ctx).score
        out.append(row)
    return out


def deriv_rows(coin: str, tf: str, min_oi: int = 300, n: int = 15000) -> list[dict]:
    d = _DATA["deriv"].get(coin)
    if not d or tf not in d["fut"] or LIQ_PERIOD[tf] not in d["fut"]:
        return []
    a = d["fut"][tf]
    if a is None or len(a["c"]) < W + H + 1:
        return []
    dt = int(a["t"][1] - a["t"][0])
    oi = d["oi"].get(tf) or []                       # [(ts, oi, oi_usd)]
    oi_t = [x[0] for x in oi]
    loi = d["oi"].get(LIQ_PERIOD[tf]) or []
    loi_t = [x[0] for x in loi]
    lk = d["fut"][LIQ_PERIOD[tf]]
    lk_rows = [[int(t_), o, h, l, c] for t_, o, h, l, c in zip(lk["t"], lk["o"], lk["h"], lk["l"], lk["c"])]
    lk_t = [r[0] for r in lk_rows]
    fr_t = [x[0] for x in d["funding"]]
    lr = np.diff(np.log(a["c"]))
    out = []
    # Only the last n candles, like the spot rows (the same series may be longer because it is
    # also another timeframe's liquidation period).
    for i in range(max(W - 1, len(a["c"]) - n), len(a["c"]) - H):
        if (int(a["t"][i]) // dt) % H:
            continue
        close_t = int(a["t"][i]) + dt
        j = bisect.bisect_right(oi_t, close_t) - 1
        if j < T.vol_lookback or oi_t[j] < close_t - dt:
            continue
        lj = bisect.bisect_right(loi_t, close_t) - 1
        if lj + 1 < min_oi:
            continue
        first, last = oi[j - T.vol_lookback][2], oi[j][2]
        f = bisect.bisect_right(fr_t, close_t) - 1
        kk = bisect.bisect_right(lk_t, close_t - 1)
        liq = _liq_map([(x[0], x[1]) for x in loi[max(0, lj - 499):lj + 1]], lk_rows[max(0, kk - 500):kk], T)
        ret, z = _z(a["c"], i, lr)
        if z is None:
            continue
        ctx = Context(c=_candles(a, i - W + 1, i + 1), t=T, funding=d["funding"][f][1] if f >= 0 else None,
                      oi_change=(last / first - 1) * 100 if first > 0 else None, liq=liq)
        out.append({"coin": coin, "tf": tf, "t": int(a["t"][i]), "ret": ret, "z": z,
                    "derivatives": crit_derivatives(ctx).score, "liquidation": crit_liquidation(ctx).score})
    return out


def _call(job):
    fn, coin, tf = job
    return (price_rows if fn == "price" else deriv_rows)(coin, tf)


def run(data: dict, jobs: list[tuple[str, str, str]], workers: int = 1) -> list[dict]:
    """jobs = [("price"|"deriv", coin, tf)]. Workers fork and inherit `data` (Linux)."""
    _DATA.clear()
    _DATA.update(data)
    if workers > 1 and "fork" in mp.get_all_start_methods():
        with mp.get_context("fork").Pool(workers) as p:
            parts = p.map(_call, jobs, chunksize=1)
    else:
        parts = [_call(j) for j in jobs]
    return [r for part in parts for r in part]
