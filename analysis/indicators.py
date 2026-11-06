"""Pure indicator functions on numpy arrays. NaN marks 'not enough data'."""
from __future__ import annotations

import numpy as np


def ema(x, n: int) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    out = np.full(len(x), np.nan)
    if n <= 0 or len(x) < n:
        return out
    out[n - 1] = x[:n].mean()
    k = 2.0 / (n + 1)
    for i in range(n, len(x)):
        out[i] = x[i] * k + out[i - 1] * (1 - k)
    return out


def _ema_skip_nan(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    valid = np.where(~np.isnan(x))[0]
    if len(valid) == 0:
        return out
    start = valid[0]
    out[start:] = ema(x[start:], n)
    return out


def rsi(x, n: int = 14) -> np.ndarray:
    """Wilder RSI."""
    x = np.asarray(x, dtype=float)
    out = np.full(len(x), np.nan)
    if len(x) <= n:
        return out
    d = np.diff(x)
    gains, losses = np.clip(d, 0, None), np.clip(-d, 0, None)
    g, l = gains[:n].mean(), losses[:n].mean()

    def val(g, l):
        return 100.0 if l == 0 else 100.0 - 100.0 / (1 + g / l)

    out[n] = val(g, l)
    for i in range(n + 1, len(x)):
        g = (g * (n - 1) + gains[i - 1]) / n
        l = (l * (n - 1) + losses[i - 1]) / n
        out[i] = val(g, l)
    return out


def macd(x, fast: int = 12, slow: int = 26, signal: int = 9):
    x = np.asarray(x, dtype=float)
    dif = ema(x, fast) - ema(x, slow)
    dea = _ema_skip_nan(dif, signal)
    return dif, dea, dif - dea


def adx(high, low, close, n: int = 14):
    """Wilder ADX. Returns (adx, +DI, -DI)."""
    h, l, c = (np.asarray(a, dtype=float) for a in (high, low, close))
    size = len(c)
    out_adx, out_p, out_m = (np.full(size, np.nan) for _ in range(3))
    if size < 2 * n + 1:
        return out_adx, out_p, out_m
    up, down = h[1:] - h[:-1], l[:-1] - l[1:]
    pdm = np.where((up > down) & (up > 0), up, 0.0)
    mdm = np.where((down > up) & (down > 0), down, 0.0)
    tr = np.maximum.reduce([h[1:] - l[1:], np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])])

    s_tr, s_p, s_m = tr[:n].sum(), pdm[:n].sum(), mdm[:n].sum()
    dx = []
    for i in range(n, len(tr) + 1):
        if i > n:
            s_tr = s_tr - s_tr / n + tr[i - 1]
            s_p = s_p - s_p / n + pdm[i - 1]
            s_m = s_m - s_m / n + mdm[i - 1]
        pdi = 100 * s_p / s_tr if s_tr else 0.0
        mdi = 100 * s_m / s_tr if s_tr else 0.0
        out_p[i], out_m[i] = pdi, mdi
        dx.append(100 * abs(pdi - mdi) / (pdi + mdi) if (pdi + mdi) else 0.0)

    a = float(np.mean(dx[:n]))
    out_adx[2 * n] = a
    for j in range(n, len(dx)):
        a = (a * (n - 1) + dx[j]) / n
        out_adx[n + j] = a
    return out_adx, out_p, out_m


def pivots(high, low, window: int = 3):
    """Confirmed swing highs/lows: bar is the extreme of `window` bars on each side.

    Returns (list of (idx, price) highs, list of (idx, price) lows)."""
    h, l = np.asarray(high, dtype=float), np.asarray(low, dtype=float)
    highs, lows = [], []
    for i in range(window, len(h) - window):
        seg_h, seg_l = h[i - window: i + window + 1], l[i - window: i + window + 1]
        if h[i] == seg_h.max() and np.argmax(seg_h) == window:
            highs.append((i, float(h[i])))
        if l[i] == seg_l.min() and np.argmin(seg_l) == window:
            lows.append((i, float(l[i])))
    return highs, lows
