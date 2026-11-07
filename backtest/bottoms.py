"""Measure the bottom-signal hit rates behind analysis/bottoms.py (RATES, N, BASE).

    python -m backtest.bottoms        # downloads full 4h/1d spot history, ~3 min

For every closed candle where price sits at a 7-day (4h) / 60-day (1d) low, count the bottom
signs and check whether that low held for the next 7 / 60 days. Prints the tables to paste
into analysis/bottoms.py, plus the older-half vs newer-half split as a stability check.
"""
from __future__ import annotations

import numpy as np

from analysis.bottoms import HORIZONS, at_low, held, sign_matrix

from .binance_hist import COINS, Http, klines


def table(series: list[dict], recent: int, span: int):
    rows = []
    for a in series:
        S = sign_matrix(a["o"], a["h"], a["l"], a["c"], a["v"])
        n = len(a["c"])
        for i in range(span, n - span):
            if at_low(a["l"], i, recent, span):
                rows.append((min(int(S[i].sum()), 3), int(held(a["l"], i, recent, span)), i >= n // 2))
    X = np.array(rows)
    out = {"base": X[:, 1].mean(), "rates": [], "n": [], "old": [], "new": []}
    for k in range(4):
        m = X[:, 0] == k
        out["rates"].append(X[m, 1].mean())
        out["n"].append(int(m.sum()))
        out["old"].append(X[m & (X[:, 2] == 0), 1].mean())
        out["new"].append(X[m & (X[:, 2] == 1), 1].mean())
    return out


def main():
    http = Http()
    for key, cfg in HORIZONS.items():
        series = [s for s in (klines(http, c + "USDT", cfg["tf"], 30000) for c in COINS) if s is not None]
        t = table(series, cfg["recent"], cfg["span"])
        print(f"{key}: BASE {t['base']:.3f}  RATES {[round(float(x), 3) for x in t['rates']]}  N {t['n']}")
        print(f"   older half {[round(float(x), 3) for x in t['old']]}  newer half {[round(float(x), 3) for x in t['new']]}", flush=True)


if __name__ == "__main__":
    main()
