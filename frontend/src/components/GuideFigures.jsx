import { useEffect, useRef, useState } from "react";
import * as D from "./guideData";

// One illustrated example per criterion for the guide. The prices are made up; indicators
// and signals are computed with the app's rules (guideData.js), and the thresholds in the
// text come from the server config (T). SVGs are drawn at the measured width so text keeps
// its size on phones.

const C = {
  price: "var(--text)", fast: "var(--ema-fast)", slow: "var(--ema-slow)", up: "var(--up)", down: "var(--down)",
  grid: "var(--border)", ref: "var(--border-hover)", muted: "var(--text-muted)", text: "var(--text)", surface: "var(--bg)",
  accent: "var(--accent)",
};
const mono = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const p = { fontSize: 14, lineHeight: 1.65, margin: "0 0 8px", maxWidth: "72ch" };
const tag = { display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", margin: "10px 0 4px" };
const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v);
const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2);
const f3 = v => (v < 0 ? "−" : "") + Math.abs(v).toFixed(3);   // true minus sign, like sgn()
const last = a => a[a.length - 1];

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const xAt = (i, n, x0, x1) => x0 + (n === 1 ? 0.5 : i / (n - 1)) * (x1 - x0);
function yScale(vals, top, bottom, padFrac = 0.1) {
  const v = vals.filter(x => x != null);
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo) * padFrac || 1;
  lo -= pad; hi += pad;
  return y => top + (hi - y) / (hi - lo) * (bottom - top);
}
const path = (arr, X, Y) => arr.reduce((d, v, i) => (v == null ? d : d + `${d && arr[i - 1] != null ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`), "");

function Legend({ items }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12, color: "var(--text-muted)" }}>
      {items.map(([name, color, kind]) => (
        <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {kind === "box"
            ? <i style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
            : kind === "band"
              ? <i style={{ width: 14, height: 10, borderRadius: 2, background: color, display: "inline-block", border: "1px solid var(--border)" }} />
              : <i style={{ width: 14, height: 2, borderRadius: 1, background: color, display: "inline-block" }} />}
          {name}
        </span>
      ))}
    </div>
  );
}

function Fig({ label, height, legend, children }) {
  const [ref, w] = useWidth();
  const h = typeof height === "function" ? height(w) : height;
  return (
    <figure style={{ margin: "4px 0 6px", display: "grid", gap: 8, minWidth: 0 }}>
      {legend && <Legend items={legend} />}
      <div ref={ref} style={{ width: "100%", minWidth: 0, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10 }}>
        <svg width={w} height={h} role="img" aria-label={label} style={{ display: "block" }}>{w > 0 && children(w, h)}</svg>
      </div>
    </figure>
  );
}

const Txt = ({ x, y, children, anchor = "start", color = C.muted, size = 11, weight, isMono }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={color} style={isMono ? mono : undefined}>{children}</text>
);
const Dot = ({ x, y, color, r = 4 }) => <circle cx={x} cy={y} r={r} fill={color} stroke={C.surface} strokeWidth="2" />;
const Chip = ({ v, children }) => (
  <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", fontSize: 13, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 9px" }}>
    {children} <b style={{ ...mono, color: v > 0 ? "var(--up)" : v < 0 ? "var(--down)" : "var(--text-muted)" }}>{sgn(v)}</b>
  </span>
);

/** Price + two EMAs in a box; returns svg elements. */
function TrendPanel({ set, x0, y0, w, h, title, fastName, slowName, priceColor = C.price }) {
  const n = set.close.length, X = i => xAt(i, n, x0 + 8, x0 + w - 8);
  const Y = yScale([...set.close, ...set.fast, ...set.slow], y0 + 22, y0 + h - 8);
  return (
    <g>
      <Txt x={x0 + 8} y={y0 + 14} color={C.text} weight="600">{title}</Txt>
      <path d={path(set.slow, X, Y)} fill="none" stroke={C.slow} strokeWidth="2" strokeLinejoin="round" />
      <path d={path(set.fast, X, Y)} fill="none" stroke={C.fast} strokeWidth="2" strokeLinejoin="round" />
      <path d={path(set.close, X, Y)} fill="none" stroke={priceColor} strokeWidth="2" strokeLinejoin="round" />
      {fastName && <title>{`${title}: giá, ${fastName}, ${slowName}`}</title>}
    </g>
  );
}

const Read = ({ children }) => (<><div style={tag}>Đọc biểu đồ này thế nào</div><p style={p}>{children}</p></>);
const Calc = ({ children }) => (<><div style={tag}>Ví dụ bằng số</div><div style={{ ...p, display: "grid", gap: 4 }}>{children}</div></>);

// ── 1. Higher timeframe ─────────────────────────────────────────────────────────

export function ExHtf({ T }) {
  const ef = `EMA${T.ema_fast}`, es = `EMA${T.ema_slow}`;
  const big = last(D.htfBig.sig), small = last(D.htfSmall.sig);
  return (
    <>
      <Fig label="Khung lớn 4H đang giảm trong khi khung 1H đang tăng" legend={[["Giá", C.price], [ef, C.fast], [es, C.slow]]}
        height={w => (w >= 560 ? 200 : 2 * 180 + 12)}>
        {(w, h) => {
          const side = w >= 560, pw = side ? (w - 12) / 2 : w, ph = side ? h : 180;
          return (<>
            <TrendPanel set={D.htfBig} x0={0} y0={0} w={pw} h={ph} title="Khung lớn 4H" fastName={ef} slowName={es} />
            {side ? <line x1={pw + 6} x2={pw + 6} y1={10} y2={h - 10} stroke={C.grid} /> : <line x1={10} x2={w - 10} y1={ph + 6} y2={ph + 6} stroke={C.grid} />}
            <TrendPanel set={D.htfSmall} x0={side ? pw + 12 : 0} y0={side ? 0 : ph + 12} w={pw} h={ph} title="Khung đang xem 1H" fastName={ef} slowName={es} />
          </>);
        }}
      </Fig>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "2px 0 4px" }}>
        <Chip v={big}>Khung lớn 4H (tiêu chí này)</Chip><Chip v={small}>Khung 1H (tiêu chí 2)</Chip>
      </div>
      <Read>
        Bên trái là khung 4H: giá (trắng) nằm dưới {ef} (vàng), {ef} nằm dưới {es} (tím), tức xu hướng giảm rõ. Bên phải
        là khung 1H cùng lúc đó: giá đang hồi lên, các đường xếp theo thứ tự tăng. Nhìn riêng khung 1H thì tưởng là xu hướng
        tăng, nhưng đó chỉ là một nhịp hồi bên trong xu hướng giảm lớn hơn.
      </Read>
      <Calc>
        <span>Khung lớn: giá &lt; {ef} &lt; {es} → tiêu chí này cho <b>{sgn(big)}</b>.</span>
        <span>Khung 1H cho {sgn(small)} ở tiêu chí 2. Hai khung ngược chiều nên trang hiện thêm cảnh báo "Khung lớn đang ngược chiều khung hiện tại".</span>
      </Calc>
    </>
  );
}

// ── 2. EMA trend ────────────────────────────────────────────────────────────────

export function ExTrend({ T }) {
  const ef = `EMA${T.ema_fast}`, es = `EMA${T.ema_slow}`;
  const s = D.trend.sig;
  const runs = [];
  s.forEach((v, i) => { if (!runs.length || runs[runs.length - 1].v !== v) runs.push({ v, a: i, b: i }); else runs[runs.length - 1].b = i; });
  const band = { 1: "rgba(47, 201, 141, 0.16)", 0.5: "rgba(47, 201, 141, 0.06)" };
  const pull = runs.find(r => r.v === 0.5);
  return (
    <>
      <Fig label="Xu hướng tăng, một nhịp điều chỉnh rồi tăng tiếp" height={230}
        legend={[["Giá", C.price], [ef, C.fast], [es, C.slow], ["Vùng +1", band[1], "band"], ["Vùng +0.5", band[0.5], "band"]]}>
        {(w, h) => {
          const n = s.length, X = i => xAt(i, n, 8, w - 8), dx = (w - 16) / (n - 1);
          const Y = yScale([...D.trend.close, ...D.trend.fast, ...D.trend.slow], 30, h - 8);
          return (<>
            {runs.map(r => band[r.v] && (
              <g key={r.a}>
                <rect x={X(r.a) - dx / 2} y={22} width={X(r.b) - X(r.a) + dx} height={h - 26} fill={band[r.v]} />
                {X(r.b) - X(r.a) > 34 && <Txt x={(X(r.a) + X(r.b)) / 2} y={16} anchor="middle" color={C.text} weight="700" isMono>{sgn(r.v)}</Txt>}
              </g>
            ))}
            <path d={path(D.trend.slow, X, Y)} fill="none" stroke={C.slow} strokeWidth="2" />
            <path d={path(D.trend.fast, X, Y)} fill="none" stroke={C.fast} strokeWidth="2" />
            <path d={path(D.trend.close, X, Y)} fill="none" stroke={C.price} strokeWidth="2" strokeLinejoin="round" />
          </>);
        }}
      </Fig>
      <Read>
        Nền xanh đậm là những đoạn tiêu chí cho +1: giá (trắng) nằm trên {ef} (vàng), và {ef} nằm trên {es} (tím). Ở giữa
        biểu đồ giá giảm xuống dưới đường vàng nhưng vẫn ở trên đường tím: đó là <b>điều chỉnh trong xu hướng tăng</b>, nền
        xanh nhạt, +0.5. Khi giá quay lại trên đường vàng thì lại là +1.
      </Read>
      <Calc>
        <span>Đầu biểu đồ: giá {f1(D.trend.close[5])} &gt; {ef} {f1(D.trend.fast[5])} &gt; {es} {f1(D.trend.slow[5])} → <b>+1</b>.</span>
        {pull && <span>Giữa nhịp điều chỉnh: giá {f1(D.trend.close[pull.a + 8])} &lt; {ef} {f1(D.trend.fast[pull.a + 8])}, nhưng vẫn &gt; {es} {f1(D.trend.slow[pull.a + 8])} → <b>+0.5</b>.</span>}
      </Calc>
    </>
  );
}

// ── 3. Structure ────────────────────────────────────────────────────────────────

export function ExStructure({ T }) {
  const S = D.structure, [, h1, l2, h2, l3] = S.piv;
  return (
    <>
      <Fig label="Đỉnh và đáy cao dần, sau đó giá vượt đỉnh gần nhất" height={240} legend={[["Giá", C.price], ["Đỉnh / đáy xác nhận", C.accent, "box"], ["Kháng cự = đỉnh gần nhất", C.ref]]}>
        {(w, h) => {
          const n = S.close.length, X = i => xAt(i, n, 10, w - 10), Y = yScale(S.close, 30, h - 26);
          const b = S.breakAt;
          return (<>
            <line x1={X(h2.i)} x2={w - 10} y1={Y(S.resistance)} y2={Y(S.resistance)} stroke={C.ref} strokeWidth="1.5" />
            <path d={path(S.close, X, Y)} fill="none" stroke={C.price} strokeWidth="2" strokeLinejoin="round" />
            {S.piv.map(pv => (
              <g key={pv.i}>
                <Dot x={X(pv.i)} y={Y(pv.v)} color={C.accent} />
                <Txt x={X(pv.i)} y={pv.kind === "high" ? Y(pv.v) - 10 : Y(pv.v) + 18} anchor="middle" color={C.text}>{pv.name}</Txt>
              </g>
            ))}
            {b > 0 && (<>
              <Dot x={X(b)} y={Y(S.close[b])} color={C.up} r={5} />
              {w >= 520
                ? <Txt x={X(b) - 9} y={Y(S.close[b]) - 9} anchor="end" color={C.up} weight="700">vượt đỉnh → +1</Txt>
                : <Txt x={w - 12} y={h - 8} anchor="end" color={C.up} weight="700">chấm xanh: vượt đỉnh → +1</Txt>}
            </>)}
          </>);
        }}
      </Fig>
      <Read>
        Các chấm cam là đỉnh/đáy đã được xác nhận: cao (hoặc thấp) nhất trong {T.pivot_window} nến mỗi bên. Đỉnh 2 cao hơn
        Đỉnh 1 (Higher High), Đáy 2 và Đáy 3 lần lượt cao hơn đáy trước (Higher Low): đó là cấu trúc của xu hướng tăng. Đường
        ngang là đỉnh gần nhất; khi giá đóng cửa trên đường này, giá đã <b>phá kháng cự</b>.
      </Read>
      <Calc>
        <span>Đỉnh {f1(h1.v)} → {f1(h2.v)} (cao hơn), đáy {f1(l2.v)} → {f1(l3.v)} (cao hơn) → HH/HL → <b>+1</b>.</span>
        <span>Cuối biểu đồ giá {f1(last(S.close))} &gt; đỉnh gần nhất {f1(S.resistance)} → phá kháng cự, cũng <b>+1</b> (điều kiện này được xét trước tiên).</span>
        <span>Ngược lại, nếu giá thủng đáy gần nhất ({f1(l3.v)}) thì cho <b>−1</b>, dù các đỉnh vẫn đang cao dần.</span>
      </Calc>
    </>
  );
}

// ── 4. Momentum ─────────────────────────────────────────────────────────────────

export function ExMomentum({ T }) {
  const M = D.momentum, n = M.close.length - 1;
  const r = M.rsi[n], r3 = M.rsi[n - 3], hh = M.hist[n], h1 = M.hist[n - 1];
  const sig = D.momentumSig(r, r3, hh, h1, T);
  return (
    <>
      <Fig label="Giá, RSI và histogram MACD khi giá hồi phục" height={300} legend={[["Giá", C.price], ["RSI 14", C.fast], ["Histogram dương", C.up, "box"], ["Histogram âm", C.down, "box"]]}>
        {(w) => {
          const N = M.close.length, X = i => xAt(i, N, 8, w - 58);
          const Yp = yScale(M.close, 22, 110);
          const Yr = v => 130 + (100 - v) / 100 * 80;
          const hv = M.hist.filter(x => x != null), hm = Math.max(...hv.map(Math.abs));
          const Yh = v => 265 - v / hm * 30;
          const bw = Math.min(24, Math.max(1, (w - 66) / N - 1));
          return (<>
            <Txt x={8} y={14} color={C.text} weight="600">Giá</Txt>
            <path d={path(M.close, X, Yp)} fill="none" stroke={C.price} strokeWidth="2" strokeLinejoin="round" />
            <Txt x={8} y={128} color={C.text} weight="600">RSI 14</Txt>
            {[T.rsi_overbought, T.rsi_mid, T.rsi_oversold].map(v => (
              <g key={v}>
                <line x1={8} x2={w - 58} y1={Yr(v)} y2={Yr(v)} stroke={v === T.rsi_mid ? C.ref : C.grid} />
                <Txt x={w - 52} y={Yr(v) + 4} isMono>{v}</Txt>
              </g>
            ))}
            <path d={path(M.rsi, X, Yr)} fill="none" stroke={C.fast} strokeWidth="2" strokeLinejoin="round" />
            <Dot x={X(n - 3)} y={Yr(r3)} color={C.fast} />
            <Dot x={X(n)} y={Yr(r)} color={C.fast} />
            <Txt x={8} y={226} color={C.text} weight="600">MACD histogram</Txt>
            <line x1={8} x2={w - 58} y1={Yh(0)} y2={Yh(0)} stroke={C.ref} />
            {M.hist.map((v, i) => v != null && (
              <rect key={i} x={X(i) - bw / 2} width={bw} y={Math.min(Yh(v), Yh(0))} height={Math.max(1, Math.abs(Yh(v) - Yh(0)))} fill={v >= 0 ? C.up : C.down} />
            ))}
          </>);
        }}
      </Fig>
      <Read>
        Ô trên là giá. Ô giữa là RSI (vàng): trên đường {T.rsi_mid} là phe mua mạnh hơn; trên {T.rsi_overbought} là quá mua. Hai
        chấm vàng là RSI hiện tại và RSI 3 nến trước, dùng để xem RSI đang đi lên hay đi xuống. Ô dưới là histogram MACD: cột
        xanh là động lượng tăng, cột đỏ là động lượng giảm; cột dài dần nghĩa là động lượng <b>mạnh lên</b>.
      </Read>
      <Calc>
        <span>RSI {f1(r)} ≥ {T.rsi_mid} và cao hơn 3 nến trước ({f1(r3)}), chưa tới {T.rsi_overbought} → phần RSI <b>{sgn(sig.rs)}</b>.</span>
        <span>
          Histogram {f3(hh)} {hh > 0 ? "dương" : "âm"}
          {hh > 0 && h1 < 0 ? `, vừa chuyển từ âm (${f3(h1)}) sang dương` : `, ${hh > h1 ? "lớn hơn" : "nhỏ hơn"} nến trước (${f3(h1)})`}
          {" "}→ {hh > 0 ? (hh > h1 ? "đang mở rộng" : "đang thu hẹp") : (hh < h1 ? "đang mở rộng về phía âm" : "đang thu hẹp")} → phần MACD <b>{sgn(sig.ms)}</b>.
        </span>
        <span>Tín hiệu = trung bình của {sgn(sig.rs)} và {sgn(sig.ms)} = <b>{sgn(sig.score)}</b>.</span>
      </Calc>
    </>
  );
}

// ── 5. Volume ───────────────────────────────────────────────────────────────────

export function ExVolume({ T }) {
  const V = D.volume, ratio = V.green / V.red;
  const sig = ratio >= T.vol_ratio ? 1 : ratio <= 1 / T.vol_ratio ? -1 : 0;
  return (
    <>
      <Fig label="20 nến và khối lượng của từng nến" height={230} legend={[["Nến xanh (đóng ≥ mở)", C.up, "box"], ["Nến đỏ", C.down, "box"]]}>
        {(w) => {
          const n = V.candles.length, slot = (w - 16) / n, X = i => 8 + slot * (i + 0.5), bw = Math.min(24, slot * 0.6);
          const Y = yScale(V.candles.flatMap(c => [c.h, c.l]), 22, 120);
          const vm = Math.max(...V.candles.map(c => c.v)), Yv = v => 220 - v / vm * 80;
          return (<>
            <Txt x={8} y={14} color={C.text} weight="600">Giá</Txt>
            {V.candles.map((c, i) => {
              const col = c.up ? C.up : C.down;
              return (
                <g key={i}>
                  <line x1={X(i)} x2={X(i)} y1={Y(c.h)} y2={Y(c.l)} stroke={col} />
                  <rect x={X(i) - bw / 2} width={bw} y={Y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(Y(c.o) - Y(c.c)))} fill={col} rx="1" />
                  <rect x={X(i) - bw / 2} width={bw} y={Yv(c.v)} height={220 - Yv(c.v)} fill={col} opacity="0.85" rx="2" />
                </g>
              );
            })}
            <Txt x={8} y={134} color={C.text} weight="600">Khối lượng</Txt>
            <line x1={8} x2={w - 8} y1={220} y2={220} stroke={C.ref} />
          </>);
        }}
      </Fig>
      <Read>
        Mỗi cột dưới là khối lượng giao dịch của cây nến ngay phía trên, cùng màu với nến. Trang cộng toàn bộ khối lượng của
        các nến xanh và của các nến đỏ trong {T.vol_lookback} nến gần nhất rồi so hai tổng.
      </Read>
      <Calc>
        <span>Tổng khối lượng nến xanh: {V.green} · nến đỏ: {V.red} (đơn vị: nghìn coin).</span>
        <span>Tỉ lệ = {V.green} ÷ {V.red} = {f2(ratio)}× ≥ {T.vol_ratio}× → <b>{sgn(sig)}</b>.</span>
        <span>Nếu tỉ lệ chỉ 1.1× (không bên nào áp đảo) thì cho 0; nếu nến đỏ áp đảo (≤ {f2(1 / T.vol_ratio)}×) thì −1.</span>
      </Calc>
    </>
  );
}

// ── 6. Derivatives ──────────────────────────────────────────────────────────────

export function ExDerivatives({ T }) {
  const Dv = D.deriv, L = Math.min(T.vol_lookback, Dv.price.length - 1);
  const k = Dv.price.length - 1 - L;
  const pc = (last(Dv.price) / Dv.price[k] - 1) * 100, oc = (last(Dv.oi) / Dv.oi[k] - 1) * 100;
  const sig = Dv.funding >= T.funding_hot ? -1 : oc >= T.oi_change_pct && pc < 0 ? -1 : oc >= T.oi_change_pct && pc > 0 && Dv.funding <= T.funding_ok_max ? 1 : 0;
  return (
    <>
      <Fig label="Giá và Open Interest cùng tăng" height={220} legend={[["Giá", C.price], ["Open Interest", C.accent], [`${L} kỳ gần nhất`, "rgba(255,255,255,0.05)", "band"]]}>
        {(w) => {
          const n = Dv.price.length, X = i => xAt(i, n, 8, w - 62);
          const Yp = yScale(Dv.price, 22, 100), Yo = yScale(Dv.oi, 128, 210);
          return (<>
            <rect x={X(k)} y={4} width={X(n - 1) - X(k)} height={212} fill="rgba(255,255,255,0.05)" />
            <Txt x={8} y={14} color={C.text} weight="600">Giá</Txt>
            <path d={path(Dv.price, X, Yp)} fill="none" stroke={C.price} strokeWidth="2" strokeLinejoin="round" />
            <Txt x={w - 56} y={Yp(last(Dv.price)) + 4} color={C.text} isMono>{pc > 0 ? "+" : ""}{f1(pc)}%</Txt>
            <line x1={8} x2={w - 8} y1={116} y2={116} stroke={C.grid} />
            <Txt x={8} y={128} color={C.text} weight="600">{w < 440 ? "Open Interest" : "Open Interest (số hợp đồng đang mở)"}</Txt>
            <path d={path(Dv.oi, X, Yo)} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" />
            <Txt x={w - 56} y={Yo(last(Dv.oi)) + 4} color={C.text} isMono>{oc > 0 ? "+" : ""}{f1(oc)}%</Txt>
          </>);
        }}
      </Fig>
      <Read>
        Ô trên là giá, ô dưới là Open Interest (OI) trên cùng trục thời gian. Vùng sáng là {L} kỳ gần nhất mà trang dùng để
        đo thay đổi. Ở đây giá tăng và OI cũng tăng mạnh: có thêm nhiều hợp đồng mới được mở trong lúc giá đi lên, tức tiền mới
        đang vào theo hướng tăng.
      </Read>
      <Calc>
        <span>OI {oc > 0 ? "+" : ""}{f1(oc)}% ≥ {T.oi_change_pct}%, giá {pc > 0 ? "+" : ""}{f1(pc)}% (tăng), funding {Dv.funding.toFixed(3)}% ≤ {T.funding_ok_max}% → <b>{sgn(sig)}</b>.</span>
        <span>Cùng OI tăng như vậy nhưng giá <i>giảm</i>: phe short đang mở thêm lệnh → <b>−1</b>.</span>
        <span>Funding ≥ {T.funding_hot}% (long trả phí cao, quá đông): <b>−1</b> bất kể giá và OI.</span>
      </Calc>
    </>
  );
}

// ── 7. BTC context ──────────────────────────────────────────────────────────────

export function ExBtc({ T }) {
  const ef = `EMA${T.ema_fast}`, es = `EMA${T.ema_slow}`, B = D.btcCtx, sig = last(B.btc.sig);
  const altChg = (last(B.alt) / B.alt[0] - 1) * 100;
  return (
    <>
      <Fig label="BTC giảm và altcoin giảm theo" height={250} legend={[["Giá", C.price], [ef, C.fast], [es, C.slow]]}>
        {(w) => {
          const n = B.alt.length, X = i => xAt(i, n, 8, w - 8), Ya = yScale(B.alt, 162, 242);
          return (<>
            <TrendPanel set={B.btc} x0={0} y0={0} w={w} h={136} title="BTC/USDT (cùng khung)" fastName={ef} slowName={es} />
            <line x1={8} x2={w - 8} y1={142} y2={142} stroke={C.grid} />
            <Txt x={8} y={158} color={C.text} weight="600">Altcoin bạn đang xem</Txt>
            <path d={path(B.alt, X, Ya)} fill="none" stroke={C.price} strokeWidth="2" strokeLinejoin="round" />
          </>);
        }}
      </Fig>
      <Read>
        Ô trên là BTC cùng khung thời gian, ô dưới là altcoin đang phân tích. Khi BTC giảm (giá dưới {ef}, {ef} dưới {es}),
        altcoin gần như luôn giảm theo, thường còn mạnh hơn: ở đây altcoin giảm {f1(Math.abs(altChg))}%.
      </Read>
      <Calc>
        <span>BTC: giá &lt; {ef} &lt; {es} → tiêu chí này cho <b>{sgn(sig)}</b> cho mọi altcoin bạn phân tích ở khung này, dù biểu đồ riêng của altcoin trông thế nào.</span>
      </Calc>
    </>
  );
}

// ── 8. Liquidation ──────────────────────────────────────────────────────────────

export function ExLiquidation({ T }) {
  const L = D.liq, sig = D.liqSig(L.s, T.liq_imbalance);
  const fmtP = v => v.toLocaleString("en-US");
  return (
    <>
      <Fig label="Các cụm thanh lý ước tính quanh giá hiện tại" height={240} legend={[["Short chờ thanh lý (phía trên)", C.up, "box"], ["Long chờ thanh lý (phía dưới)", C.down, "box"]]}>
        {(w, h) => {
          const Y = v => 14 + (3.4 - v) / (3.4 + 4.3) * (h - 28);
          const right = Math.min(170, w * 0.45), bmax = w - right - 16, um = Math.max(...L.clusters.map(c => c.usd));
          return (<>
            <line x1={8} x2={w - 8} y1={Y(0)} y2={Y(0)} stroke={C.ref} />
            <Txt x={w - 8} y={Y(0) - 6} anchor="end" color={C.text} isMono weight="700">giá {fmtP(L.price)}</Txt>
            {L.clusters.map(c => (
              <g key={c.pct}>
                <rect x={8} y={Y(c.pct) - 6} width={Math.max(3, c.usd / um * bmax)} height={12} rx="2" fill={c.side === "short" ? C.up : C.down} />
                <Txt x={14 + Math.max(3, c.usd / um * bmax)} y={Y(c.pct) + 4} color={C.text} isMono>${c.usd}M · {c.pct > 0 ? "+" : "−"}{Math.abs(c.pct)}%</Txt>
              </g>
            ))}
          </>);
        }}
      </Fig>
      <Read>
        Đường ngang là giá hiện tại. Thanh xanh phía trên là các lệnh short sẽ bị thanh lý nếu giá tăng tới đó, thanh đỏ phía
        dưới là các lệnh long sẽ bị thanh lý nếu giá giảm tới đó. Thanh càng dài càng nhiều tiền. Cụm vừa lớn vừa gần giá thì
        hút giá mạnh nhất.
      </Read>
      <Calc>
        <span>Lực hút mỗi cụm = số tiền ÷ khoảng cách (%):</span>
        <span style={mono}>
          Lên (short): {L.clusters.filter(c => c.side === "short").map(c => `${c.usd}÷${Math.abs(c.pct)}`).join(" + ")} = {f1(L.up)}
        </span>
        <span style={mono}>
          Xuống (long): {L.clusters.filter(c => c.side === "long").map(c => `${c.usd}÷${Math.abs(c.pct)}`).join(" + ")} = {f1(L.down)}
        </span>
        <span>Chênh lệch = ({f1(L.up)} − {f1(L.down)}) ÷ ({f1(L.up)} + {f1(L.down)}) = <b>{f2(L.s)}</b>.</span>
        <span>
          {Math.abs(sig) === 1 ? `|${f2(L.s)}| ≥ ${f2(2 * T.liq_imbalance)}` : sig === 0 ? `|${f2(L.s)}| < ${T.liq_imbalance}` : `|${f2(L.s)}| ≥ ${T.liq_imbalance} nhưng < ${f2(2 * T.liq_imbalance)}`}
          {" "}→ <b>{sgn(sig)}</b>{Math.abs(sig) === 0.5 ? " (nghiêng một phần)" : ""}. Cụm short ${L.clusters[1].usd}M chỉ cách
          +{L.clusters[1].pct}% là lực kéo chính.
        </span>
      </Calc>
    </>
  );
}
