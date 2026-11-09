import { useEffect, useRef, useState } from "react";
import { fetchScores } from "../lib/api";

// Score of the coin on screen over time, one line per timeframe, recorded every minute on the
// server for the Admin chart pairs. Legend buttons hide/show lines; the timeframe on screen is
// drawn thicker. Hover / arrow keys show every visible line at that time; a hidden table
// carries the latest values for screen readers. Colours: the dark steps of the categorical
// palette, in fixed order by timeframe (never cycled).

const SERIES = [
  { tf: "5m", name: "5m", color: "#3987e5" },
  { tf: "15m", name: "15m", color: "#d95926" },
  { tf: "30m", name: "30m", color: "#199e70" },
  { tf: "1h", name: "1H", color: "#c98500" },
  { tf: "4h", name: "4H", color: "#d55181" },
  { tf: "12h", name: "12H", color: "#008300" },
  { tf: "1d", name: "1D", color: "#9085e9" },
];
const RANGES = [["6h", "6 giờ"], ["24h", "24 giờ"], ["7d", "7 ngày"], ["30d", "30 ngày"], ["90d", "90 ngày"]];
const TICKS = [100, 50, 0, -50, -100];
const REFRESH_MS = 60000;
const pad2 = n => String(n).padStart(2, "0");
const fmtTick = (ms, rng) => {
  const d = new Date(ms);
  return rng === "6h" || rng === "24h" ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${d.getDate()}/${d.getMonth() + 1}`;
};
const fmtFull = ms => new Date(ms).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
const fmtScore = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(0);
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export default function ScoreHistory({ symbol, tf }) {
  const wrap = useRef(null);   // chart area (pointer position)
  const box = useRef(null);    // whole card (width, also before any data)
  const [width, setWidth] = useState(600);
  const [rng, setRng] = useState(() => load("ca-hist-range", "24h"));
  const [hidden, setHidden] = useState(() => load("ca-hist-hidden", []));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(null);

  useEffect(() => {
    let alive = true;
    const get = () => fetchScores(symbol, rng).then(d => { if (alive) { setData(d); setErr(""); } })
      .catch(e => alive && setErr(e.message));
    get();
    const t = setInterval(get, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [symbol, rng]);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pickRange = r => { setRng(r); save("ca-hist-range", r); setActive(null); };
  const toggle = k => {
    const next = hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k];
    setHidden(next); save("ca-hist-hidden", next);
  };

  const t = data?.t || [];
  const has = data && SERIES.some(s => (data.series[s.tf] || []).some(v => v != null));
  const shown = SERIES.filter(s => !hidden.includes(s.tf));
  const narrow = width < 480;
  const H = narrow ? 210 : 250, padL = 40, padR = 12, padT = 10, padB = 24;
  const x = i => padL + (t.length > 1 ? i / (t.length - 1) : 0.5) * (width - padL - padR);
  const y = v => padT + (100 - v) / 200 * (H - padT - padB);
  const nX = narrow ? 3 : 6;
  const xTicks = t.length > 1 ? [...new Set(Array.from({ length: nX }, (_, k) => Math.round(k * (t.length - 1) / (nX - 1))))] : [];

  const nearest = clientX => {
    const r = wrap.current.getBoundingClientRect();
    const i = Math.round((clientX - r.left - padL) / (width - padL - padR) * (t.length - 1));
    return Math.min(t.length - 1, Math.max(0, i));
  };
  const onKey = e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive(a => Math.min(t.length - 1, Math.max(0, (a ?? (d > 0 ? -1 : t.length)) + d)));
    } else if (e.key === "Escape") setActive(null);
  };
  const path = vals => vals.reduce((acc, v, i) => (v == null ? acc : acc + `${i && vals[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`), "");
  const lastIdx = s => { const v = data.series[s.tf] || []; for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i; return -1; };

  const tip = active != null && has ? shown.map(s => ({ s, v: data.series[s.tf]?.[active] })).filter(e => e.v != null) : [];
  const tipLeft = active != null ? (x(active) + 12 + 170 > width ? Math.max(0, x(active) - 182) : x(active) + 12) : 0;

  const seg = on => ({
    border: 0, padding: "5px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    fontFamily: "var(--font-mono)", background: on ? "var(--text)" : "transparent", color: on ? "var(--bg)" : "var(--text-muted)",
  });

  return (
    <section ref={box} aria-label="Lịch sử điểm" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, display: "grid", gap: 12, minWidth: 0, position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", fontWeight: 600 }}>
          Lịch sử điểm · {symbol}
        </div>
        {/* Narrow: one row of 5 equal columns instead of wrapping */}
        <div role="group" aria-label="Khoảng thời gian" style={{ display: narrow ? "grid" : "flex", gridTemplateColumns: `repeat(${RANGES.length}, minmax(0, 1fr))`, width: narrow ? "100%" : undefined, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9, padding: 2 }}>
          {RANGES.map(([k, txt]) => <button key={k} type="button" aria-pressed={rng === k} onClick={() => pickRange(k)} style={{ ...seg(rng === k), padding: narrow ? "5px 0" : "5px 10px", fontSize: narrow ? 11 : 12 }}>{txt}</button>)}
        </div>
      </div>

      <div role="group" aria-label="Khung hiển thị" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SERIES.map(s => {
          const on = !hidden.includes(s.tf);
          return (
            <button key={s.tf} type="button" aria-pressed={on} onClick={() => toggle(s.tf)}
              title={on ? `Ẩn khung ${s.name}` : `Hiện khung ${s.name}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 16, cursor: "pointer",
                fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: s.tf === tf ? 800 : 600,
                border: `1px solid ${s.tf === tf ? "var(--border-hover)" : "var(--border)"}`, background: "transparent",
                color: on ? "var(--text)" : "var(--text-muted)", opacity: on ? 1 : 0.55 }}>
              <i style={{ width: 14, height: s.tf === tf ? 3 : 2, borderRadius: 2, background: on ? s.color : "var(--text-muted)", display: "inline-block" }} />
              {s.name}
            </button>
          );
        })}
      </div>

      {err && !data && <p style={{ fontSize: 13, color: "var(--down)" }}>{err}</p>}
      {data && !data.recorded && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Chưa ghi điểm cho {symbol}. Điểm được ghi mỗi phút cho các cặp coin có trên biểu đồ phía trên.
        </p>
      )}
      {data && data.recorded && !has && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Chưa có dữ liệu trong khoảng này. Điểm được ghi mỗi phút; quay lại sau ít phút.
        </p>
      )}

      {has && (
        <div ref={wrap} style={{ position: "relative", minWidth: 0, overflow: "hidden" }}
          onPointerMove={e => setActive(nearest(e.clientX))} onPointerLeave={() => setActive(null)}>
          <svg width={width} height={H} role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setActive(null)}
            aria-label={`Điểm của ${symbol} theo thời gian, ${shown.length} khung. Dùng phím mũi tên để đọc từng mốc.`}
            style={{ display: "block", outline: "none" }}>
            {TICKS.map(v => (
              <g key={v}>
                <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--border-hover)" : "var(--border)"} strokeWidth="1" />
                <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)" style={{ fontFamily: "var(--font-mono)" }}>{v === 0 ? "0" : fmtScore(v)}</text>
              </g>
            ))}
            {xTicks.map(i => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === t.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--text-muted)">{fmtTick(t[i], rng)}</text>
            ))}
            {active != null && <line x1={x(active)} x2={x(active)} y1={padT} y2={H - padB} stroke="var(--border-hover)" strokeWidth="1" />}
            {/* the timeframe on screen last, so it is drawn on top */}
            {[...shown.filter(s => s.tf !== tf), ...shown.filter(s => s.tf === tf)].map(s => {
              const vals = data.series[s.tf] || [];
              const li = lastIdx(s);
              return (
                <g key={s.tf}>
                  <path d={path(vals)} fill="none" stroke={s.color} strokeWidth={s.tf === tf ? 2.5 : 1.5} strokeOpacity={s.tf === tf ? 1 : 0.85} strokeLinejoin="round" strokeLinecap="round" />
                  {li >= 0 && <circle cx={x(li)} cy={y(vals[li])} r={s.tf === tf ? 3.5 : 2.5} fill={s.color} />}
                  {active != null && vals[active] != null && <circle cx={x(active)} cy={y(vals[active])} r="4" fill={s.color} stroke="var(--bg-card)" strokeWidth="2" />}
                </g>
              );
            })}
          </svg>

          {active != null && (
            <div role="status" style={{ position: "absolute", top: 4, left: tipLeft, width: 170, pointerEvents: "none", background: "var(--bg)",
              border: "1px solid var(--border-hover)", borderRadius: 8, padding: "8px 10px", fontSize: 12, zIndex: 1 }}>
              <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>{fmtFull(t[active])}</div>
              {tip.length ? tip.map(({ s, v }) => (
                <div key={s.tf} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <i style={{ width: 10, height: 2, background: s.color, display: "inline-block" }} />
                  <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", width: 30, fontWeight: s.tf === tf ? 800 : 400 }}>{s.name}</span>
                  <b style={{ fontFamily: "var(--font-mono)", color: "var(--text)", marginLeft: "auto" }}>{fmtScore(v)}</b>
                </div>
              )) : <div style={{ color: "var(--text-muted)" }}>Không có dữ liệu</div>}
            </div>
          )}
        </div>
      )}

      {has && (
        <table style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          <caption>Điểm gần nhất theo khung của {symbol}</caption>
          <thead><tr><th>Khung</th><th>Điểm</th><th>Lúc</th></tr></thead>
          <tbody>
            {SERIES.map(s => { const i = lastIdx(s); return i < 0 ? null : <tr key={s.tf}><td>{s.name}</td><td>{fmtScore(data.series[s.tf][i])}</td><td>{fmtFull(t[i])}</td></tr>; })}
          </tbody>
        </table>
      )}
    </section>
  );
}
