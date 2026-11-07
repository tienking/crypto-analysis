import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeCoin, fetchAnalysisConfig } from "../lib/api";

// Coin trend score: 8 weighted criteria on Binance data, −100..+100 (ported from coin-analysis).
// UI text is Vietnamese. API data is only ever rendered as text, never as HTML.

const TIMEFRAMES = [["5m", "5m"], ["15m", "15m"], ["1h", "1H"], ["4h", "4H"], ["12h", "12H"], ["1d", "1D"]];
const REFRESH_MS = 60000;
const VERDICT_COLOR = { strong_up: "var(--up)", lean_up: "var(--up)", strong_down: "var(--down)", lean_down: "var(--down)", neutral: "var(--warn)", ranging: "var(--warn)" };
const PILL = { bull: "Tăng", bear: "Giảm", neutral: "Trung tính", na: "Thiếu dữ liệu" };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

function fp(p) {
  if (p == null || !isFinite(p)) return "—";
  const a = Math.abs(p), d = a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8;
  return p.toLocaleString("en-US", { minimumFractionDigits: Math.min(d, 4), maximumFractionDigits: d });
}
const pct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
const sgn = v => (v > 0 ? "+" : "") + v.toFixed(1);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function useNarrow(px = 760) {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

const panel = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, minWidth: 0 };
const label = { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", fontWeight: 600 };
const num = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

/**
 * `request` = {symbol, n} from a click on the chart's coin list; `onAnalyzed(params)` reports the
 * analysis on screen (symbol, timeframe, thresholds, weights) so the chatbot can talk about it.
 */
export default function Analysis({ request, onAnalyzed }) {
  const narrow = useNarrow();
  const last = store.get("ca-last");
  const [input, setInput] = useState(last?.symbol || "BTC");
  const [tf, setTf] = useState(last?.tf || "4h");
  const [cfg, setCfg] = useState(null);
  const [T, setT] = useState(null);
  const [W, setW] = useState(null);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ kind: "", msg: "Đang tải…" });
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);
  const busy = useRef(0);
  const skipTyping = useRef(null); // a symbol set by the chart, already analysed
  const current = useRef({}); // latest params, read by the timer and debounced input
  current.current = { symbol: input, tf, T, W };

  const run = useCallback(async (override = {}) => {
    const { symbol, tf: timeframe, T: thresholds, W: weights } = { ...current.current, ...override };
    const clean = (symbol || "").trim();
    if (clean.replace(/[^a-z0-9]/gi, "").length < 2 || !thresholds || !weights) return;
    const id = ++busy.current;
    setStatus({ kind: "", msg: `Đang phân tích ${clean.toUpperCase()} · ${timeframe}…` });
    setError("");
    try {
      const d = await analyzeCoin({ symbol: clean, timeframe, thresholds, weights });
      if (id !== busy.current) return;
      setData(d);
      setStatus({ kind: "live", msg: `Cập nhật ${new Date().toLocaleTimeString("vi-VN")}` });
      store.set("ca-last", { symbol: clean, tf: timeframe });
      onAnalyzed?.({ symbol: clean, timeframe, thresholds, weights });
    } catch (e) {
      if (id !== busy.current) return;
      setStatus({ kind: "err", msg: "Lỗi" });
      setError(e.message);
    }
  }, [onAnalyzed]);

  // Defaults from the server, then the visitor's saved overrides (once).
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    fetchAnalysisConfig().then(c => {
      const t = { ...c.thresholds, ...(store.get("ca-thresholds") || {}) };
      const w = { ...c.weights, ...(store.get("ca-weights") || {}) };
      setCfg(c); setT(t); setW(w);
      run({ T: t, W: w });
    }).catch(() => setStatus({ kind: "err", msg: "Không tải được cấu hình" }));
  }, [run]);

  // A coin picked on the chart: analyse it.
  useEffect(() => {
    if (!request?.symbol) return;
    const symbol = request.symbol.replace(/USDT$/i, "");
    skipTyping.current = symbol;
    setInput(symbol);
    run({ symbol });
  }, [request, run]);

  // Typing: analyse after a pause (not for the first value or one set by the chart).
  const firstInput = useRef(true);
  useEffect(() => {
    if (firstInput.current) { firstInput.current = false; return undefined; }
    if (skipTyping.current === input) { skipTyping.current = null; return undefined; }
    const t = setTimeout(() => run(), 800);
    return () => clearTimeout(t);
  }, [input, run]);

  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => run(), REFRESH_MS);
    return () => clearInterval(t);
  }, [auto, run]);

  const changeSetting = (group, key, raw) => {
    const v = parseFloat(raw);
    if (!isFinite(v)) return;
    const t = group === "t" ? { ...T, [key]: v } : T;
    const w = group === "w" ? { ...W, [key]: v } : W;
    setT(t); setW(w);
    store.set("ca-thresholds", t); store.set("ca-weights", w);
    run({ T: t, W: w });
  };
  const resetSettings = () => {
    const t = { ...cfg.thresholds }, w = { ...cfg.weights };
    store.del("ca-thresholds"); store.del("ca-weights");
    setT(t); setW(w);
    run({ T: t, W: w });
  };

  return (
    <section aria-label="Phân tích xu hướng coin" style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em" }}>Phân tích xu hướng</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>8 tiêu chí kỹ thuật có trọng số · điểm từ −100 đến +100 · dữ liệu Binance</p>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <form onSubmit={e => { e.preventDefault(); run(); }}
          style={{ display: "flex", alignItems: "center", background: "var(--bg-card)", border: "1.5px solid var(--border)", borderRadius: 10, padding: "0 4px 0 12px", flex: "1 1 220px", minWidth: 0 }}>
          <input aria-label="Mã coin" value={input} maxLength={15} spellCheck={false} autoComplete="off"
            onChange={e => setInput(e.target.value)}
            style={{ border: 0, background: "transparent", color: "var(--text)", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16, padding: "10px 4px", width: "100%", minWidth: 0, textTransform: "uppercase", outline: "none" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)", paddingRight: 6 }}>/USDT</span>
          <button type="submit" style={{ background: "var(--accent)", color: "#000", border: 0, borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-display)", whiteSpace: "nowrap", flexShrink: 0 }}>Phân tích</button>
        </form>
        <div role="group" aria-label="Khung thời gian" style={{ display: "inline-flex", background: "var(--bg-card)", border: "1.5px solid var(--border)", borderRadius: 10, padding: 3 }}>
          {TIMEFRAMES.map(([key, text]) => (
            <button key={key} type="button" aria-pressed={tf === key} onClick={() => { setTf(key); run({ tf: key }); }}
              style={{ border: 0, padding: "7px 12px", borderRadius: 7, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 13, cursor: "pointer", background: tf === key ? "var(--text)" : "transparent", color: tf === key ? "var(--bg)" : "var(--text-muted)" }}>
              {text}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: status.kind === "live" ? "var(--up)" : status.kind === "err" ? "var(--down)" : "var(--na)" }} />
        <span role="status">{status.msg}</span>
        <label style={{ display: "flex", gap: 5, alignItems: "center", marginLeft: "auto", cursor: "pointer" }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Tự làm mới 60s
        </label>
      </div>

      {error && <div role="alert" style={{ background: "var(--down-soft)", color: "var(--down)", borderRadius: 10, padding: "10px 14px", fontWeight: 600, fontSize: 14 }}>{error}</div>}

      {data && <Verdict d={data} narrow={narrow} />}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "minmax(0,1.6fr) minmax(0,1fr)", gap: 16 }}>
          <div style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={label}>{data.chart.close.length} nến gần nhất · {data.timeframe}</span>
              <span style={{ display: "flex", gap: 12, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                <Legend color="var(--ema-fast)" text={`EMA${data.thresholds.ema_fast}`} />
                <Legend color="var(--ema-slow)" text={`EMA${data.thresholds.ema_slow}`} />
              </span>
            </div>
            <CandleChart chart={data.chart} height={narrow ? 220 : 260} />
          </div>
          <div style={panel}>
            <div style={{ ...label, marginBottom: 10 }}>Chỉ số hiện tại</div>
            <Readings d={data} />
          </div>
        </div>
      )}

      {data?.liquidation && <Liquidation liq={data.liquidation} narrow={narrow} />}

      {data && (
        <section style={panel} aria-label="Bảng tiêu chí">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <h3 style={{ fontSize: 16 }}>Bảng tiêu chí</h3>
            <span style={label}>Trọng số × tín hiệu = điểm đóng góp</span>
          </div>
          <ol style={{ listStyle: "none", display: "grid", gap: 8, marginTop: 6 }}>
            {data.criteria.map(c => <Criterion key={c.id} c={c} narrow={narrow} />)}
          </ol>
        </section>
      )}

      {cfg && T && W && <Settings cfg={cfg} T={T} W={W} onChange={changeSetting} onReset={resetSettings} />}

      <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", maxWidth: "70ch", margin: "0 auto", lineHeight: 1.5 }}>
        Dữ liệu: Binance Spot và USDⓈ-M Futures. Công cụ chỉ đọc chỉ báo kỹ thuật, không dự đoán chắc chắn và không phải lời khuyên đầu tư.
      </p>
    </section>
  );
}

function Legend({ color, text }) {
  return <span><i style={{ display: "inline-block", width: 14, height: 3, borderRadius: 2, verticalAlign: "middle", marginRight: 5, background: color }} />{text}</span>;
}

function Verdict({ d, narrow }) {
  const s = Math.max(-100, Math.min(100, d.score));
  const c = d.counts;
  const zone = (flex, bg, radius) => <span style={{ flex, height: "100%", background: bg, borderRadius: radius }} />;
  return (
    <section aria-live="polite" style={{ ...panel, padding: 18, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "flex-end" }}>
        <div style={{ minWidth: 0 }}>
          <div style={label}>Kết luận · {d.symbol} · khung {d.timeframe} (khung lớn {d.higher_timeframe})</div>
          <div style={{ fontSize: narrow ? 22 : 26, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.015em", color: VERDICT_COLOR[d.verdict.key], marginTop: 4 }}>{d.verdict.title}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4, maxWidth: "88ch", lineHeight: 1.5 }}>{d.verdict.note}</div>
        </div>
        <div style={{ textAlign: narrow ? "left" : "right" }}>
          <div style={label}>{d.symbol} · {d.source}</div>
          <div style={{ ...num, fontWeight: 700, fontSize: 26 }}>{fp(d.price)}</div>
          <div style={{ ...num, fontWeight: 600, fontSize: 14, color: d.price_change_pct >= 0 ? "var(--up)" : "var(--down)" }}>
            {pct(d.price_change_pct)} / {d.thresholds.vol_lookback} nến
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 6, paddingTop: 22 }}>
        <div style={{ position: "relative", display: "flex", height: 12, borderRadius: 6 }}>
          {zone(25, "var(--down)", "6px 0 0 6px")}{zone(15, "var(--down-soft)")}{zone(20, "var(--border-hover)")}{zone(15, "var(--up-soft)")}{zone(25, "var(--up)", "0 6px 6px 0")}
          <span data-score={d.score} style={{ position: "absolute", top: -6, left: `${(s + 100) / 2}%`, width: 4, height: 24, background: "var(--text)", borderRadius: 2, transform: "translateX(-50%)", transition: "left .5s ease" }}>
            <b style={{ ...num, position: "absolute", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "var(--text)", color: "var(--bg)", fontSize: 13, padding: "1px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>{sgn(d.score)}</b>
          </span>
        </div>
        <div style={{ ...num, display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
          <span>−100</span><span>Giảm</span><span>0</span><span>Tăng</span><span>+100</span>
        </div>
      </div>

      <div style={{ ...num, fontSize: 13, color: "var(--text-muted)", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span style={{ color: "var(--up)" }}>▲ {c.bull} tăng</span>
        <span style={{ color: "var(--down)" }}>▼ {c.bear} giảm</span>
        <span>● {c.neutral} trung tính</span>
        {c.na > 0 && <span>○ {c.na} thiếu dữ liệu</span>}
      </div>

      {d.warnings.length > 0 && (
        <ul style={{ listStyle: "none", display: "grid", gap: 6 }}>
          {d.warnings.map(w => <li key={w} style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 600 }}>{w}</li>)}
        </ul>
      )}
    </section>
  );
}

const usd = v => {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;
};

/**
 * Estimated liquidation map: one row per price bin (high prices on top), shorts waiting above
 * the price (green: their forced buys pull price up), longs below (red). Hover = exact values.
 */
function Liquidation({ liq, narrow }) {
  const [hover, setHover] = useState(null);
  const bins = [...liq.bins].reverse();                 // top row = highest price
  const max = Math.max(...bins.map(b => Math.max(b.long, b.short)), 1);
  const rowH = narrow ? 6 : 7, H = bins.length * rowH;
  const p = liq.price;
  const priceY = bins.findIndex(b => b.price < p);     // first bin under the price
  const ticks = bins.map((b, i) => ({ b, i })).filter(({ i }) => i % 4 === 0);
  const tops = [liq.top_short, liq.top_long].filter(Boolean).map(t => t.price);
  const hb = hover == null ? null : bins[hover];
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientY - r.top) / rowH);
    setHover(i >= 0 && i < bins.length ? i : null);
  };
  const side = (t, name, color) => (
    <div>
      <div style={label}>Cụm {name} lớn nhất</div>
      {t ? (<>
        <div style={{ ...num, fontWeight: 700, fontSize: 16 }}>{fp(t.price)}</div>
        <div style={{ ...num, fontSize: 12, color: "var(--text-muted)" }}>
          <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: color, marginRight: 6 }} />
          {usd(t.usd)} · cách {pct(t.dist_pct, 1)}
        </div>
      </>) : <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Không có trong ±{liq.range_pct}%</div>}
    </div>
  );
  const up = liq.pull_up;
  return (
    <section style={{ ...panel, display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "minmax(0,1.6fr) minmax(0,1fr)", gap: 16 }} aria-label="Vùng thanh lý ước tính">
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={label}>Vùng thanh lý ước tính · ±{liq.range_pct}%</span>
          <span style={{ display: "flex", gap: 12, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
            <Legend color="var(--up)" text="Short (phía trên)" />
            <Legend color="var(--down)" text="Long (phía dưới)" />
          </span>
        </div>
        <div style={{ position: "relative", height: H, marginRight: 76 }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} aria-hidden="true">
          {bins.map((b, i) => {
            const v = b.short || b.long, isShort = b.short >= b.long;
            return (
              <div key={b.price} style={{ position: "absolute", left: 0, right: 0, top: i * rowH, height: rowH, background: hover === i ? "var(--border)" : "transparent" }}>
                {v > 0 && <span style={{ position: "absolute", left: 0, top: 1, height: rowH - 2, width: `${Math.max(v / max * 100, 0.6)}%`, borderRadius: "0 2px 2px 0", background: isShort ? "var(--up)" : "var(--down)", opacity: hover == null || hover === i ? 1 : 0.55 }} />}
              </div>
            );
          })}
          {priceY > 0 && (
            <div style={{ position: "absolute", left: 0, right: -76, top: priceY * rowH, borderTop: "1px dashed var(--text-muted)" }}>
              <b style={{ ...num, position: "absolute", right: 0, top: -9, background: "var(--text)", color: "var(--bg)", fontSize: 11, padding: "1px 6px", borderRadius: 4 }}>{fp(p)}</b>
            </div>
          )}
          {ticks.map(({ b, i }) => Math.abs(i - priceY) > 1 && (
            <span key={"t" + i} style={{ ...num, position: "absolute", right: -76, width: 70, top: i * rowH - 6, fontSize: 10, color: tops.includes(b.price) ? "var(--text)" : "var(--text-muted)" }}>{fp(b.price)}</span>
          ))}
          {hb && (hb.long > 0 || hb.short > 0) && (
            <div style={{ position: "absolute", left: 8, top: Math.min(hover * rowH + 10, H - 52), background: "var(--bg)", border: "1px solid var(--border-hover)", borderRadius: 8, padding: "6px 9px", fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 1 }}>
              <div style={{ ...num, fontWeight: 700 }}>~{fp(hb.price)} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({pct((hb.price / p - 1) * 100, 2)})</span></div>
              <div style={{ color: "var(--text-muted)" }}>{hb.short > 0 ? "Short" : "Long"} chờ thanh lý: <b style={{ ...num, color: "var(--text)" }}>{usd(hb.short || hb.long)}</b></div>
            </div>
          )}
        </div>
        <table style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          <caption>Vùng thanh lý ước tính theo mức giá</caption>
          <thead><tr><th>Giá</th><th>Long</th><th>Short</th></tr></thead>
          <tbody>{bins.filter(b => b.long || b.short).map(b => <tr key={b.price}><td>{fp(b.price)}</td><td>{usd(b.long)}</td><td>{usd(b.short)}</td></tr>)}</tbody>
        </table>
      </div>
      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        {side(liq.top_short, "short", "var(--up)")}
        {side(liq.top_long, "long", "var(--down)")}
        {up != null && (
          <div>
            <div style={label}>Lực hút (lớn và gần thì mạnh)</div>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 2, marginTop: 6 }}>
              <span style={{ flex: up, background: "var(--up)" }} />
              <span style={{ flex: 1 - up, background: "var(--down)" }} />
            </div>
            <div style={{ ...num, display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
              <span>▲ lên {(up * 100).toFixed(0)}%</span><span>▼ xuống {((1 - up) * 100).toFixed(0)}%</span>
            </div>
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Ước tính từ lịch sử Open Interest Binance (khung {liq.period}) với đòn bẩy giả định 10x–100x, không phải lệnh thật.
          Giá thường bị hút về cụm lớn và gần, nhưng hay đảo chiều sau khi quét xong.
        </p>
      </div>
    </section>
  );
}

function Readings({ d }) {
  const i = d.indicators, t = d.thresholds;
  const rows = [
    ["EMA" + t.ema_fast, fp(i.ema_fast), i.ema_fast == null ? "" : d.price > i.ema_fast ? "Giá nằm trên" : "Giá nằm dưới"],
    ["EMA" + t.ema_slow, fp(i.ema_slow), i.ema_slow == null ? "Chưa đủ nến" : d.price > i.ema_slow ? "Giá nằm trên" : "Giá nằm dưới"],
    ["RSI 14", i.rsi == null ? "—" : i.rsi.toFixed(1), i.rsi == null ? "" : i.rsi >= t.rsi_overbought ? "Quá mua" : i.rsi <= t.rsi_oversold ? "Quá bán" : "Bình thường"],
    ["ADX 14", i.adx == null ? "—" : i.adx.toFixed(1), i.adx == null ? "" : i.adx < t.adx_trend_min ? "Đi ngang" : i.adx > 40 ? "Xu hướng rất mạnh" : "Có xu hướng"],
    ["Funding", i.funding_pct == null ? "—" : i.funding_pct.toFixed(4) + "%", i.funding_pct == null ? "Không có futures" : i.funding_pct > 0 ? "Long trả phí" : "Short trả phí"],
    ["Open Interest", pct(i.oi_change_pct), `Thay đổi ${t.vol_lookback} kỳ`],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
      {rows.map(([name, value, hint]) => (
        <div key={name}>
          <div style={label}>{name}</div>
          <div style={{ ...num, fontWeight: 700, fontSize: 16 }}>{value}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{hint}</div>
        </div>
      ))}
    </div>
  );
}

function Criterion({ c, narrow }) {
  const tone = {
    bull: { bg: "var(--up-soft)", border: "transparent", pillBg: "var(--up)", pillFg: "var(--bg)", pts: "var(--up)" },
    bear: { bg: "var(--down-soft)", border: "transparent", pillBg: "var(--down)", pillFg: "var(--bg)", pts: "var(--down)" },
    neutral: { bg: "transparent", border: "var(--border)", pillBg: "var(--bg)", pillFg: "var(--text-muted)", pts: "var(--text)" },
    na: { bg: "transparent", border: "var(--border)", pillBg: "transparent", pillFg: "var(--na)", pts: "var(--text-muted)" },
  }[c.status];
  const sig = c.score == null ? "" : ` ${c.score > 0 ? "+" : ""}${c.score}`;
  const side = (
    <div style={{ display: "grid", gap: 4, justifyItems: narrow ? "start" : "end", ...(narrow ? { gridColumn: 2, gridAutoFlow: "column", alignItems: "center", gap: 10, justifyContent: "start" } : {}) }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap", textTransform: "uppercase", background: tone.pillBg, color: tone.pillFg, border: c.status === "na" ? "1px dashed var(--na)" : "none" }}>
        {PILL[c.status]}{c.status === "na" ? "" : sig}
      </span>
      <span style={{ ...num, fontWeight: 700, fontSize: 15, color: tone.pts }}>{c.points == null ? "—" : sgn(c.points) + " đ"}</span>
    </div>
  );
  return (
    <li data-status={c.status} style={{ display: "grid", gridTemplateColumns: narrow ? "44px minmax(0,1fr)" : "52px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 10, border: `1px solid ${tone.border}`, background: tone.bg, opacity: c.status === "na" ? 0.6 : 1 }}>
      <div style={{ display: "grid", justifyItems: "center", gap: 2 }}>
        <b style={{ ...num, fontSize: 16 }}>{c.weight}</b>
        <small style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>trọng số</small>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{c.rule}</div>
        <div style={{ ...num, fontSize: 12, marginTop: 3, overflowWrap: "anywhere" }}>{c.detail}</div>
      </div>
      {side}
    </li>
  );
}

function Settings({ cfg, T, W, onChange, onReset }) {
  const field = (group, key, text, value) => (
    <label key={`${group}-${key}`} style={{ display: "grid", gap: 4, fontSize: 13, color: "var(--text-muted)" }}>
      {text}
      <input type="number" step="any" defaultValue={value} onChange={e => onChange(group, key, e.target.value)}
        style={{ ...num, fontWeight: 600, fontSize: 14, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", width: "100%" }} />
    </label>
  );
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginTop: 10 };
  // Remount the inputs on reset so they show the defaults again.
  const key = JSON.stringify([T, W]) === JSON.stringify([cfg.thresholds, cfg.weights]) ? "defaults" : "custom";
  return (
    <details style={panel}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Ngưỡng và trọng số (chỉnh được)</summary>
      <div key={key}>
        <h4 style={{ fontSize: 13, margin: "16px 0 0", color: "var(--text-muted)" }}>Trọng số</h4>
        <div style={grid}>{Object.entries(cfg.criteria).map(([k, text]) => field("w", k, text, W[k]))}</div>
        <h4 style={{ fontSize: 13, margin: "16px 0 0", color: "var(--text-muted)" }}>Ngưỡng</h4>
        <div style={grid}>{Object.entries(cfg.threshold_labels).map(([k, text]) => field("t", k, text, T[k]))}</div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="button" onClick={onReset} style={{ background: "transparent", color: "var(--accent)", border: "1.5px solid var(--accent)", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-display)" }}>Khôi phục mặc định</button>
      </div>
      <ul style={{ fontSize: 13, color: "var(--text-muted)", margin: "14px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Mỗi tiêu chí cho tín hiệu từ −1 (giảm) đến +1 (tăng), ±0.5 là tín hiệu một phần.</li>
        <li>Điểm = Σ(trọng số × tín hiệu) / Σ trọng số của các tiêu chí có dữ liệu × 100.</li>
        <li>Nếu ADX dưới ngưỡng, kết luận là <b>Đi ngang</b> bất kể điểm, vì tín hiệu khi không có xu hướng thường nhiễu.</li>
      </ul>
    </details>
  );
}

/** The last candles with both EMAs, drawn on a canvas (redrawn on resize). */
function CandleChart({ chart, height }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1, W_ = cv.clientWidth, H = cv.clientHeight;
      cv.width = W_ * dpr; cv.height = H * dpr;
      const g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W_, H);
      const n = chart.close.length;
      if (!n) return;
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < n; i++) {
        mn = Math.min(mn, chart.low[i], chart.ema_fast[i] ?? Infinity, chart.ema_slow[i] ?? Infinity);
        mx = Math.max(mx, chart.high[i], chart.ema_fast[i] ?? -Infinity, chart.ema_slow[i] ?? -Infinity);
      }
      const pad = (mx - mn) * 0.04; mn -= pad; mx += pad;
      const padR = 66, padT = 8, cw = W_ - padR, chH = H - padT * 2, bw = cw / n;
      const y = p => padT + (mx - p) / (mx - mn) * chH;
      const mono = cssVar("--font-mono");
      g.font = "11px " + mono; g.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const p = mn + (mx - mn) * k / 4, yy = Math.round(y(p)) + 0.5;
        g.strokeStyle = cssVar("--border"); g.beginPath(); g.moveTo(0, yy); g.lineTo(cw, yy); g.stroke();
        g.fillStyle = cssVar("--text-muted"); g.fillText(fp(p), cw + 6, yy + 4);
      }
      const up = cssVar("--up"), dn = cssVar("--down");
      for (let i = 0; i < n; i++) {
        const x = i * bw + bw / 2, col = chart.close[i] >= chart.open[i] ? up : dn;
        g.strokeStyle = col; g.fillStyle = col;
        g.beginPath(); g.moveTo(x, y(chart.high[i])); g.lineTo(x, y(chart.low[i])); g.stroke();
        const top = y(Math.max(chart.open[i], chart.close[i])), bot = y(Math.min(chart.open[i], chart.close[i]));
        g.fillRect(x - bw * 0.35, top, Math.max(bw * 0.7, 1), Math.max(bot - top, 1));
      }
      const line = (a, col) => {
        g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath();
        let started = false;
        a.forEach((v, i) => {
          if (v == null) return;
          const x = i * bw + bw / 2;
          if (started) g.lineTo(x, y(v)); else { g.moveTo(x, y(v)); started = true; }
        });
        g.stroke();
      };
      line(chart.ema_fast, cssVar("--ema-fast")); line(chart.ema_slow, cssVar("--ema-slow"));
      const lc = chart.close[n - 1], ly = y(lc);
      g.fillStyle = lc >= chart.open[n - 1] ? up : dn; g.fillRect(cw + 2, ly - 9, padR - 2, 18);
      g.fillStyle = cssVar("--bg"); g.font = "700 11px " + mono; g.fillText(fp(lc), cw + 6, ly + 4);
    };
    draw();
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(draw, 150); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(t); };
  }, [chart, height]);
  return <canvas ref={ref} aria-label="Biểu đồ nến kèm EMA" style={{ width: "100%", height, display: "block" }} />;
}
