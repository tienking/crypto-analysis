// Illustrative series for the guide's figures. Prices are made up (deterministic), but every
// indicator and signal is computed with the same rules as the server (analysis/indicators.py,
// analysis/criteria.py), so what a figure says always matches how the app scores.

export function ema(x, n) {
  const out = new Array(x.length).fill(null);
  if (x.length < n) return out;
  let v = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = v;
  const k = 2 / (n + 1);
  for (let i = n; i < x.length; i++) { v = x[i] * k + v * (1 - k); out[i] = v; }
  return out;
}

export function rsi(x, n = 14) {
  const out = new Array(x.length).fill(null);
  if (x.length <= n) return out;
  const d = x.slice(1).map((v, i) => v - x[i]);
  let g = d.slice(0, n).reduce((a, v) => a + Math.max(v, 0), 0) / n;
  let l = d.slice(0, n).reduce((a, v) => a + Math.max(-v, 0), 0) / n;
  const val = () => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[n] = val();
  for (let i = n + 1; i < x.length; i++) {
    g = (g * (n - 1) + Math.max(d[i - 1], 0)) / n;
    l = (l * (n - 1) + Math.max(-d[i - 1], 0)) / n;
    out[i] = val();
  }
  return out;
}

export function macdHist(x) {
  const f = ema(x, 12), s = ema(x, 26);
  const dif = x.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
  const start = dif.findIndex(v => v != null);
  const dea = new Array(x.length).fill(null);
  const e = ema(dif.slice(start), 9);
  e.forEach((v, i) => { dea[start + i] = v; });
  return dif.map((v, i) => (v == null || dea[i] == null ? null : v - dea[i]));
}

/** Piecewise-linear path through `knots` [[t 0..1, value]] plus a small deterministic wiggle. */
export function walk(n, knots, amp = 1, seed = 1) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    let k = 0;
    while (k < knots.length - 2 && t > knots[k + 1][0]) k++;
    const [t0, v0] = knots[k], [t1, v1] = knots[k + 1];
    const v = v0 + (v1 - v0) * (t - t0) / (t1 - t0 || 1);
    // Three slow-ish waves instead of one fast one: reads like a market, not a saw blade.
    return v + amp * (0.5 * Math.sin(i * 0.61 + seed) + 0.35 * Math.sin(i * 0.23 + seed * 2) + 0.25 * Math.sin(i * 1.37 + seed * 3));
  });
}

/** Same rule as trend_signal() in analysis/criteria.py. */
export function trendSig(p, f, s) {
  if (f == null || s == null) return null;
  if (p > f && f > s) return 1;
  if (p < f && f < s) return -1;
  if (p > s && f > s) return 0.5;
  if (p < s && f < s) return -0.5;
  return 0;
}

function trendSet(close, fast, slow, show) {
  const f = ema(close, fast), s = ema(close, slow);
  const k = close.length - show;
  const c = close.slice(k), F = f.slice(k), S = s.slice(k);
  return { close: c, fast: F, slow: S, sig: c.map((p, i) => trendSig(p, F[i], S[i])) };
}

// 1. Higher timeframe: the bigger picture falls while the timeframe on screen bounces.
export const htfBig = trendSet(walk(170, [[0, 128], [0.4, 116], [0.7, 103], [1, 92]], 1.2, 1), 10, 30, 110);
export const htfSmall = trendSet(walk(150, [[0, 86], [0.5, 88], [1, 97]], 0.5, 3), 10, 30, 90);

// 2. EMA trend: a rise, a pullback under the fast EMA (+0.5), then the trend resumes (+1).
export const trend = trendSet(walk(200, [[0, 90], [0.55, 120], [0.625, 114], [0.7, 114.5], [1, 135]], 0.3, 3), 15, 60, 140);

// 3. Structure: zig-zag with confirmed swing points, then a break above the last high.
export const structure = (() => {
  const knots = [[0, 102], [0.08, 100], [0.2, 112], [0.34, 104], [0.52, 118], [0.68, 109], [0.86, 117], [1, 124]];
  const close = walk(120, knots, 0.35, 5);
  const piv = [
    { i: Math.round(0.08 * 119), kind: "low", name: "Đáy 1" },
    { i: Math.round(0.2 * 119), kind: "high", name: "Đỉnh 1" },
    { i: Math.round(0.34 * 119), kind: "low", name: "Đáy 2 (HL)" },
    { i: Math.round(0.52 * 119), kind: "high", name: "Đỉnh 2 (HH)" },
    { i: Math.round(0.68 * 119), kind: "low", name: "Đáy 3 (HL)" },
  ].map(p => ({ ...p, v: close[p.i] }));
  const resistance = piv[3].v;
  const breakAt = close.findIndex((v, i) => i > piv[4].i && v > resistance);
  return { close, piv, resistance, breakAt };
})();

// 4. Momentum: a dip, then a recovery; RSI and MACD computed on the same closes.
export const momentum = (() => {
  const all = walk(170, [[0, 112], [0.45, 96], [0.7, 102], [1, 104]], 0.8, 3);
  const r = rsi(all), h = macdHist(all), k = 34;               // from the first MACD value: the dip is in view
  return { close: all.slice(k), rsi: r.slice(k), hist: h.slice(k) };
})();

/** Same rule as crit_momentum(). */
export function momentumSig(rsiNow, rsi3, h, h1, T) {
  let rs = 0;
  if (rsiNow >= T.rsi_mid && rsiNow > rsi3) rs = rsiNow >= T.rsi_overbought ? 0.5 : 1;
  else if (rsiNow < T.rsi_mid && rsiNow < rsi3) rs = rsiNow <= T.rsi_oversold ? -0.5 : -1;
  const ms = h > 0 ? (h > h1 ? 1 : 0.5) : h < 0 ? (h < h1 ? -1 : -0.5) : 0;
  return { rs, ms, score: (rs + ms) / 2 };
}

// 5. Volume: 20 candles, buyers' candles carry more volume. Volumes in thousands of coins.
export const volume = (() => {
  const up = [1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1];
  const vols = [80, 95, 60, 110, 70, 90, 120, 55, 85, 100, 65, 130, 50, 75, 105, 45, 90, 115, 60, 125];
  let p = 100;
  const candles = up.map((u, i) => {
    const o = p, c = p + (u ? 1 : -1) * (0.6 + (i % 3) * 0.35);
    p = c;
    return { o, c, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, v: u ? vols[i] : 2 * vols[i], up: c >= o };
  });
  const green = candles.filter(x => x.up).reduce((a, x) => a + x.v, 0);
  const red = candles.filter(x => !x.up).reduce((a, x) => a + x.v, 0);
  return { candles, green, red };
})();

// 6. Derivatives: price and open interest rise together over the lookback window.
export const deriv = (() => {
  const price = walk(40, [[0, 101], [0.5, 100], [1, 104.5]], 0.25, 4);
  const oi = walk(40, [[0, 990], [0.5, 1000], [1, 1080]], 3, 6);
  return { price, oi, funding: 0.01 };
})();

// 7. BTC context: BTC falls, the altcoin follows.
export const btcCtx = (() => {
  const btc = trendSet(walk(170, [[0, 80], [0.45, 79], [0.75, 74], [1, 70]], 0.5, 8), 10, 30, 100);
  const base = btc.close;
  const alt = base.map((v, i) => 2.1 * (v / base[0]) ** 1.6 + 0.02 * Math.sin(i * 0.9));
  return { btc, alt };
})();

// 8. Liquidation: clusters waiting around the price (USD millions, distance in %).
export const liq = (() => {
  const price = 75900;
  const clusters = [
    { pct: 2.8, usd: 40, side: "short" }, { pct: 1.2, usd: 120, side: "short" }, { pct: 0.6, usd: 15, side: "short" },
    { pct: -0.9, usd: 20, side: "long" }, { pct: -2.5, usd: 90, side: "long" }, { pct: -3.7, usd: 60, side: "long" },
  ].map(c => ({ ...c, price: Math.round(price * (1 + c.pct / 100)), pull: c.usd / Math.max(Math.abs(c.pct), 0.2) }));
  const up = clusters.filter(c => c.side === "short").reduce((a, c) => a + c.pull, 0);
  const down = clusters.filter(c => c.side === "long").reduce((a, c) => a + c.pull, 0);
  return { price, clusters, up, down, s: (up - down) / (up + down) };
})();

export const liqSig = (s, imb) => { const a = Math.abs(s); const v = a < imb ? 0 : a >= 2 * imb ? 1 : 0.5; return s >= 0 ? v : -v; };
