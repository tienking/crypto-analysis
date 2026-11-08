"""Fill the download cache without running the backtest.

    python -m backtest.prefetch

Downloads (or tops up) everything the weekly run reads, through `cache.series()`: Binance
spot candles, the bottom-signal candles and Bybit's futures candles, OI and funding. A later
`backtest.reweight` then only fetches what is new. Safe to run any time, also during a run.
"""
from __future__ import annotations

import time

from analysis.bottoms import HORIZONS
from analysis.config import HIGHER_TF, LIQ_PERIOD

from . import bybit_hist, engine
from .binance_hist import COINS, Http, cached_klines
from .reweight import N_CANDLES, TF_MS, TFS
from .store import sync_db

BOTTOM_CANDLES = 30000   # as backtest.bottoms.measure


def main():
    db = sync_db()
    http, bybit = Http(), Http(bybit_hist.PAUSE)
    t0 = time.time()
    tfs = sorted(set(TFS) | {HIGHER_TF[t] for t in TFS}, key=lambda t: TF_MS.get(t, 10**12))
    for c in COINS:
        t = time.time()
        now = int(time.time() * 1000)
        for tf in tfs:
            cached_klines(db, http, c + "USDT", tf, N_CANDLES, now)
        for cfg in HORIZONS.values():
            cached_klines(db, http, c + "USDT", cfg["tf"], BOTTOM_CANDLES, now)
        d = bybit_hist.load_coin(bybit, c, TFS, LIQ_PERIOD, now, N_CANDLES, engine.W, db)
        print(f"[prefetch] {c}: {time.time() - t:.0f}s{'' if d else ' (not on Bybit)'}", flush=True)
    n = db["cache"].count_documents({})
    print(f"[prefetch] done in {time.time() - t0:.0f}s, {n} cached series", flush=True)


if __name__ == "__main__":
    main()
