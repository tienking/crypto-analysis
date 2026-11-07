import { useEffect, useRef, useState } from "react";

// Backtest runs over time: per weight group, the test IC of the weights in effect after each
// weekly run. Filled dot = new weights applied that run, hollow = kept. Hover/arrow keys show
// every series at that run; a hidden table carries the same values for screen readers.

const SERIES = [
  { key: "short", name: "5m – 1H", color: "#3987e5" },
  { key: "long", name: "4H – 1D", color: "#d95926" },
];
const SURFACE = "var(--bg-card)";
const fmtDay = d => new Date(String(d).endsWith("Z") ? d : d + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtFull = d => new Date(String(d).endsWith("Z") ? d : d + "Z").toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const fmtIc = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(3);
const time = d => new Date(String(d).endsWith("Z") ? d : d + "Z").getTime();

function niceTicks(lo, hi) {
  const span = hi - lo || 0.01;
  const step = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1].find(s => span / s <= 5) || 0.2;
  // Round outwards so the highest and lowest values always sit inside the axis.
  const first = Math.floor(lo / step + 1e-9), last = Math.ceil(hi / step - 1e-9);
  return Array.from({ length: last - first + 1 }, (_, k) => Math.round((first + k) * step * 1000) / 1000);
}

export default function RunsChart({ history }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(300);   // measured from the container, never from the svg
  const [active, setActive] = useState(null);       // index of the hovered / focused run

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const runs = history.filter(r => SERIES.some(s => r[s.key]));
  if (!runs.length) {
    return <p style={{ fontSize: 12, color: "var(--text-muted)" }}>The chart appears after the first completed weekly run.</p>;
  }

  const narrow = width < 480;
  const H = narrow ? 200 : 230, padL = 46, padR = narrow ? 12 : 64, padT = 14, padB = 26;
  const vals = runs.flatMap(r => SERIES.map(s => r[s.key]?.ic).filter(v => v != null));
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0.01, ...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const t0 = time(runs[0].started_at), t1 = time(runs[runs.length - 1].started_at);
  const x = i => (runs.length === 1 ? (padL + width - padR) / 2 : padL + (time(runs[i].started_at) - t0) / (t1 - t0) * (width - padL - padR));
  const y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);

  const nX = Math.min(runs.length, narrow ? 3 : 6);
  const xTicks = runs.length === 1 ? [0] : [...new Set(Array.from({ length: nX }, (_, k) => Math.round(k * (runs.length - 1) / (nX - 1))))];

  const nearest = clientX => {
    const r = wrap.current.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    runs.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    return best;
  };
  const onKey = e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive(a => Math.min(runs.length - 1, Math.max(0, (a ?? (d > 0 ? -1 : runs.length)) + d)));
    } else if (e.key === "Escape") setActive(null);
  };

  // End labels only when they do not collide (the legend + tooltip carry them otherwise).
  const last = runs.length - 1;
  const ends = SERIES.map(s => ({ s, v: runs[last][s.key]?.ic })).filter(e => e.v != null);
  const showEnds = !narrow && (ends.length < 2 || Math.abs(y(ends[0].v) - y(ends[1].v)) >= 14);

  const a = active != null ? runs[active] : null;
  const tipLeft = a ? Math.min(Math.max(x(active) + 12, 0), width - 220) : 0;
  const tipFlip = a && x(active) + 12 + 210 > width;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
        {SERIES.map(s => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 14, height: 2, borderRadius: 1, background: s.color, display: "inline-block" }} />{s.name}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--text-muted)" /></svg>new weights applied
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" /></svg>kept
        </span>
      </div>

      <div ref={wrap} style={{ position: "relative", minWidth: 0, overflow: "hidden" }}
        onPointerMove={e => setActive(nearest(e.clientX))} onPointerLeave={() => setActive(null)}>
        <svg width={width} height={H} role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setActive(null)}
          aria-label={`Test IC of the active weights after each backtest run, ${runs.length} runs. Use the arrow keys to read each run.`}
          style={{ display: "block", outline: "none" }}>
          {ticks.map(v => (
            <g key={v}>
              <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--border-hover)" : "var(--border)"} strokeWidth="1" />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{v === 0 ? "0" : fmtIc(v)}</text>
            </g>
          ))}
          {lo === 0 && <text x={width - padR} y={y(0) - 5} textAnchor="end" fontSize="10" fill="var(--text-muted)">0 = no edge</text>}
          {xTicks.map(i => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={runs.length === 1 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"} fontSize="11" fill="var(--text-muted)">{fmtDay(runs[i].started_at)}</text>
          ))}
          {a && <line x1={x(active)} x2={x(active)} y1={padT} y2={H - padB} stroke="var(--border-hover)" strokeWidth="1" />}
          {SERIES.map(s => {
            const pts = runs.map((r, i) => (r[s.key] ? [x(i), y(r[s.key].ic)] : null));
            const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? "L" : "M"}${p[0]},${p[1]}` : acc), "");
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {runs.map((r, i) => r[s.key] && (
                  <circle key={i} cx={x(i)} cy={y(r[s.key].ic)} r={active === i ? 5 : 4}
                    fill={r[s.key].applied ? s.color : SURFACE} stroke={r[s.key].applied ? SURFACE : s.color} strokeWidth="2" />
                ))}
              </g>
            );
          })}
          {showEnds && ends.map(({ s, v }) => (
            <text key={s.key} x={x(last) + 9} y={y(v) + 4} fontSize="11" fill="var(--text)" style={{ fontFamily: "var(--font-mono)" }}>{fmtIc(v)}</text>
          ))}
        </svg>

        {a && (
          <div role="status" style={{ position: "absolute", top: 4, left: tipFlip ? Math.max(0, x(active) - 222) : tipLeft, width: 210, pointerEvents: "none",
            background: "var(--bg)", border: "1px solid var(--border-hover)", borderRadius: 8, padding: "8px 10px", fontSize: 12, zIndex: 1 }}>
            <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>{fmtFull(a.started_at)}</div>
            {SERIES.map(s => a[s.key] && (
              <div key={s.key} style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <i style={{ width: 10, height: 2, background: s.color, display: "inline-block", alignSelf: "center" }} />
                <b style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmtIc(a[s.key].ic)}</b>
                <span style={{ color: "var(--text-muted)" }}>
                  {s.name} · {a[s.key].applied ? `applied (was ${fmtIc(a[s.key].before)})` : "kept"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <table style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        <caption>Test IC of the active weights after each backtest run</caption>
        <thead><tr><th>Run</th>{SERIES.map(s => <th key={s.key}>{s.name}</th>)}</tr></thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.started_at}>
              <td>{fmtFull(r.started_at)}</td>
              {SERIES.map(s => <td key={s.key}>{r[s.key] ? `${fmtIc(r[s.key].ic)} (${r[s.key].applied ? "applied" : "kept"})` : "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
