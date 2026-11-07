import { useEffect, useRef, useState } from "react";
import { fetchAnalysisConfig } from "../lib/api";
import { ExBtc, ExDerivatives, ExHtf, ExLiquidation, ExMomentum, ExStructure, ExTrend, ExVolume } from "./GuideFigures";

// Full-screen beginner guide: what every criterion means, why it is there and exactly how it
// is computed. Numbers (thresholds, weights) come from /analysis/config, so the text always
// matches what the server uses. Vietnamese, like the rest of the analysis UI.

const CRITERIA = ["htf", "trend", "structure", "momentum", "volume", "derivatives", "btc", "liquidation"];
const HIGHER = [["5m", "30m"], ["15m", "1H"], ["30m", "2H"], ["1H", "4H"], ["4H", "1D"], ["12H", "3D"], ["1D", "1W"]];

const h2 = { fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", margin: "0 0 10px" };
const h3 = { fontSize: 16, fontWeight: 700, margin: "0 0 6px" };
const p = { fontSize: 15, lineHeight: 1.65, color: "var(--text)", margin: "0 0 10px", maxWidth: "72ch" };
const muted = { ...p, color: "var(--text-muted)", fontSize: 14 };
const ul = { ...p, paddingLeft: 20, display: "grid", gap: 4 };
const code = { fontFamily: "var(--font-mono)", fontSize: 13, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" };
const box = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 18px 8px" };
const tag = { display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", margin: "6px 0 4px" };
const th = { textAlign: "left", padding: "6px 10px 6px 0", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 };
const td = { padding: "6px 10px 6px 0", borderTop: "1px solid var(--border)", fontSize: 14 };

const C = ({ children }) => <code style={code}>{children}</code>;
const Sig = ({ v, children }) => (
  <li><b style={{ fontFamily: "var(--font-mono)", color: v > 0 ? "var(--up)" : v < 0 ? "var(--down)" : "var(--text-muted)" }}>{v > 0 ? "+" : v < 0 ? "−" : ""}{Math.abs(v)}</b> {children}</li>
);

const formula = { fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.7, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", margin: "0 0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" };

function Indicator({ name, what, f, read }) {
  return (
    <div style={{ ...box, minWidth: 0 }}>
      <h3 style={h3}>{name}</h3>
      <div style={tag}>Mô tả</div>
      <p style={p}>{what}</p>
      <div style={tag}>Công thức</div>
      <pre style={formula}>{f}</pre>
      <div style={tag}>Cách đọc</div>
      <p style={p}>{read}</p>
    </div>
  );
}

function Criterion({ id, n, title, why, ex, children }) {
  return (
    <section id={`g-${id}`} style={{ ...box, minWidth: 0 }} aria-labelledby={`g-${id}-t`}>
      <h3 id={`g-${id}-t`} style={h3}>{n}. {title}</h3>
      <div style={tag}>Mô tả</div>
      <p style={p}>{why}</p>
      <div style={tag}>Cách tính</div>
      {children}
      {ex && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6 }}>
          <div style={tag}>Ví dụ minh hoạ</div>
          {ex}
        </div>
      )}
    </section>
  );
}

export default function Guide({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    fetchAnalysisConfig().then(setCfg).catch(() => setCfg(false));
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";          // the page behind does not scroll
    closeRef.current?.focus();
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);

  const T = cfg?.thresholds || {
    ema_fast: 50, ema_slow: 200, rsi_mid: 50, rsi_overbought: 75, rsi_oversold: 25, vol_lookback: 20, vol_ratio: 1.2,
    oi_change_pct: 3, funding_ok_max: 0.03, funding_hot: 0.05, pivot_window: 3, adx_trend_min: 20, score_strong: 50,
    score_lean: 20, liq_range_pct: 5, liq_imbalance: 0.25,
  };
  const names = cfg?.criteria || {};
  const sets = cfg?.weight_sets;
  const ef = `EMA${T.ema_fast}`, es = `EMA${T.ema_slow}`;

  // zIndex above the chat button (1002): the guide covers the whole screen.
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="guide-title"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "var(--bg)", overflowY: "auto", overscrollBehavior: "contain" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        {/* Full width so the close button sits in the top-right corner of the screen. */}
        <div style={{ padding: "14px max(16px, min(24px, 4vw))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 id="guide-title" style={{ fontSize: 18, fontWeight: 800 }}>Hướng dẫn đọc phân tích</h1>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng hướng dẫn"
            style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, border: "1px solid var(--border-hover)", background: "transparent", color: "var(--text)", fontSize: 20, lineHeight: 1, cursor: "pointer" }}>
            ✕
          </button>
        </div>
      </div>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px max(16px, min(24px, 4vw)) 64px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 28 }}>
        <nav aria-label="Mục lục" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[["g-indicators", "Các chỉ số"], ["g-criteria", "Các tiêu chí"], ["g-score", "Cách tính điểm"], ["g-warn", "Cảnh báo"], ["g-weights", "Trọng số"], ["g-bottoms", "Dấu hiệu đáy"], ["g-limits", "Giới hạn"]].map(([id, t]) => (
            <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              style={{ fontSize: 13, color: "var(--text)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 999, padding: "6px 12px" }}>{t}</a>
          ))}
        </nav>

        <section id="g-indicators" style={{ display: "grid", gap: 14, scrollMarginTop: 80 }}>
          <h2 style={h2}>Các chỉ số</h2>
          <p style={muted}>
            Các chỉ số kỹ thuật mà các tiêu chí bên dưới sử dụng. Mỗi <b>nến</b> là một khoảng thời gian (khung 4H thì mỗi nến
            là 4 giờ) với giá Mở, Cao, Thấp, Đóng và khối lượng. Nến xanh: Đóng ≥ Mở; nến đỏ: Đóng &lt; Mở. Nếu không ghi khác,
            chỉ số được tính trên giá Đóng.
          </p>
          <Indicator name={`EMA (đường trung bình động hàm mũ): ${ef}, ${es}`}
            what={`Giá trung bình của n nến gần nhất, trong đó nến càng gần càng được tính nặng hơn, nên EMA bám giá nhanh hơn trung bình thường. Trang dùng ${ef} (nhanh) và ${es} (chậm).`}
            f={"k = 2 ÷ (n + 1)\nEMA = Đóng × k + EMA nến trước × (1 − k)\nGiá trị đầu tiên = trung bình cộng giá Đóng của n nến đầu"}
            read={`Giá trên EMA: giá đang ở phía trên đường trung bình. ${ef} nằm trên ${es}: xu hướng gần đây mạnh hơn xu hướng dài hạn, tức xu hướng tăng; ngược lại là xu hướng giảm. ${es} cần đủ ${T.ema_slow} nến mới tính được.`} />
          <Indicator name="MA (trung bình đơn giản)"
            what="Trung bình cộng thông thường, mọi nến tính như nhau."
            f={"MA(n) = (giá trị nến 1 + … + giá trị nến n) ÷ n"}
            read="Dùng trong phần Dấu hiệu đáy: MA200 tuần (giá trung bình khoảng 4 năm) và trung bình volume 20 nến để nhận ra nến bán tháo." />
          <Indicator name="RSI(14) (chỉ số sức mạnh tương đối)"
            what="So độ lớn các nhịp tăng với các nhịp giảm trong khoảng 14 nến gần đây, thang 0–100."
            f={"d = Đóng − Đóng nến trước\nTăng = d nếu d > 0, ngược lại 0  ·  Giảm = −d nếu d < 0, ngược lại 0\nTB tăng, TB giảm: lần đầu = trung bình 14 nến;\n  sau đó = (TB cũ × 13 + giá trị mới) ÷ 14\nRSI = 100 − 100 ÷ (1 + TB tăng ÷ TB giảm)"}
            read={`Trên ${T.rsi_mid}: bên mua mạnh hơn; dưới ${T.rsi_mid}: bên bán mạnh hơn. RSI ≥ ${T.rsi_overbought} là quá mua, ≤ ${T.rsi_oversold} là quá bán (phần Dấu hiệu đáy dùng mốc 30).`} />
          <Indicator name="MACD(12, 26, 9)"
            what="Đo đà của giá bằng khoảng cách giữa một EMA ngắn và một EMA dài."
            f={"Đường MACD = EMA12 − EMA26\nĐường tín hiệu = EMA9 của đường MACD\nHistogram = Đường MACD − Đường tín hiệu"}
            read="Đường MACD trên 0: EMA ngắn nằm trên EMA dài, đà tăng. Histogram dương và lớn dần: đà tăng đang mạnh lên. Histogram âm nhưng co dần về 0: đà giảm đang yếu đi." />
          <Indicator name="ADX(14) (chỉ số định hướng trung bình)"
            what="Đo độ mạnh của xu hướng, không quan tâm lên hay xuống, thang 0–100."
            f={"Lên = Cao − Cao nến trước  ·  Xuống = Thấp nến trước − Thấp\n+DM = Lên nếu Lên > Xuống và Lên > 0, ngược lại 0\n−DM = Xuống nếu Xuống > Lên và Xuống > 0, ngược lại 0\nTR = lớn nhất của (Cao − Thấp, |Cao − Đóng nến trước|, |Thấp − Đóng nến trước|)\nCộng dồn 14 kỳ: Tổng mới = Tổng cũ − Tổng cũ ÷ 14 + giá trị mới\n+DI = 100 × +DM14 ÷ TR14  ·  −DI = 100 × −DM14 ÷ TR14\nDX = 100 × |+DI − −DI| ÷ (+DI + −DI)\nADX = (ADX cũ × 13 + DX) ÷ 14, giá trị đầu = trung bình 14 DX đầu"}
            read={`ADX dưới ${T.adx_trend_min}: giá đi ngang, kết luận luôn là "Đi ngang". Từ ${T.adx_trend_min} đến 40: có xu hướng. Trên 40: xu hướng rất mạnh.`} />
          <Indicator name="Volume (khối lượng)"
            what="Số coin được mua bán trong một nến."
            f={`Tỉ lệ volume = Tổng volume nến xanh ÷ Tổng volume nến đỏ\n(trong ${T.vol_lookback} nến gần nhất)`}
            read={`Tỉ lệ ≥ ${T.vol_ratio}×: bên mua áp đảo; ≤ 1 ÷ ${T.vol_ratio}: bên bán áp đảo. Giá tăng mà volume nhỏ thì dễ là nhịp tăng yếu.`} />
          <Indicator name="Đỉnh, đáy (pivot)"
            what="Các điểm giá quay đầu, dùng để đọc cấu trúc giá."
            f={`Đỉnh = nến có giá Cao lớn nhất trong ${T.pivot_window} nến trước và ${T.pivot_window} nến sau nó\nĐáy = nến có giá Thấp nhỏ nhất trong ${T.pivot_window} nến trước và ${T.pivot_window} nến sau nó`}
            read={`Cần thêm ${T.pivot_window} nến sau mới xác nhận được, nên đỉnh/đáy mới nhất luôn trễ ${T.pivot_window} nến. Đỉnh sau cao hơn đỉnh trước (HH) và đáy sau cao hơn đáy trước (HL) là cấu trúc tăng.`} />
          <Indicator name="Open Interest (OI, hợp đồng mở)"
            what="Tổng giá trị (USD) các hợp đồng futures đang mở trên Binance. Mỗi hợp đồng có một bên long và một bên short."
            f={`% thay đổi OI = (OI hiện tại ÷ OI ${T.vol_lookback} kỳ trước − 1) × 100`}
            read="OI tăng: tiền mới đang vào vị thế. OI tăng cùng lúc giá tăng: dòng tiền mới ủng hộ đà tăng. OI giảm: các vị thế đang đóng lại (chốt lời hoặc bị thanh lý)." />
          <Indicator name="Funding rate (phí funding)"
            what="Phí trả định kỳ mỗi 8 giờ giữa phe long và phe short của hợp đồng vĩnh cửu, để giá futures bám sát giá spot."
            f={"Funding > 0: long trả cho short  ·  Funding < 0: short trả cho long\nPhí mỗi lần = giá trị vị thế × funding"}
            read={`Dương nhẹ (≤ ${T.funding_ok_max}%) là bình thường khi thị trường tăng. Từ ${T.funding_hot}% trở lên: phe long quá đông, dễ bị xả. Âm từ −${T.funding_ok_max}% trở xuống: phe short đông, có thể bị ép (short squeeze).`} />
        </section>


        <section id="g-criteria" style={{ display: "grid", gap: 14, scrollMarginTop: 80 }}>
          <h2 style={h2}>Các tiêu chí</h2>
          <p style={muted}>
            Mỗi tiêu chí cho một tín hiệu từ −1 (giảm) đến +1 (tăng); cách gộp chúng thành điểm nằm ở mục "Cách tính điểm" bên
            dưới. Mỗi tiêu chí có một ví dụ minh hoạ. Giá trong ví dụ là giá giả lập để thấy rõ từng trường hợp (chu kỳ EMA cũng
            được rút ngắn cho vừa khung hình), nhưng mọi chỉ báo và tín hiệu trong ví dụ đều được tính bằng đúng quy tắc trang
            đang dùng.
          </p>

          <Criterion id="htf" ex={<ExHtf T={T} />} n={1} title={names.htf || "Đồng thuận khung lớn"}
            why="Xu hướng trên khung dài thường bền hơn khung ngắn. Một tín hiệu tăng ở khung 1H mà khung 4H đang giảm mạnh thì dễ chỉ là một nhịp hồi. Tiêu chí này hỏi: bức tranh lớn có ủng hộ không?">
            <p style={p}>Áp dụng đúng cách tính của tiêu chí 2 (Xu hướng EMA), nhưng trên <b>khung lớn hơn</b>:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 10px" }}>
              {HIGHER.map(([a, b]) => <C key={a}>{a} → {b}</C>)}
            </div>
            <p style={muted}>Nến khung lớn đang chạy dở cũng được tính, với giá hiện tại làm giá đóng.</p>
          </Criterion>

          <Criterion id="trend" ex={<ExTrend T={T} />} n={2} title={names.trend || "Xu hướng EMA"}
            why={`Hai đường trung bình ${ef} (nhanh) và ${es} (chậm) là cách phổ biến nhất để xác định xu hướng. Khi giá nằm trên cả hai và đường nhanh nằm trên đường chậm, thị trường đang ở xu hướng tăng; ngược lại là xu hướng giảm.`}>
            <ul style={ul}>
              <Sig v={1}>Giá &gt; {ef} &gt; {es}: xu hướng tăng rõ.</Sig>
              <Sig v={0.5}>Giá trên {es} và {ef} trên {es}, nhưng giá đang dưới {ef}: điều chỉnh trong xu hướng tăng.</Sig>
              <Sig v={0}>Các trường hợp còn lại (các đường đan xen).</Sig>
              <Sig v={-0.5}>Giá dưới {es} và {ef} dưới {es}, nhưng giá đang trên {ef}: hồi trong xu hướng giảm.</Sig>
              <Sig v={-1}>Giá &lt; {ef} &lt; {es}: xu hướng giảm rõ.</Sig>
            </ul>
            <p style={muted}>
              Coin mới niêm yết chưa đủ {T.ema_slow} nến cho {es}: dùng {ef} và hướng của nó (so với 5 nến trước). Giá
              trên {ef} và {ef} đang đi lên thì +0.5, giá dưới {ef} và {ef} đang đi xuống thì −0.5, còn lại 0.
            </p>
          </Criterion>

          <Criterion id="structure" ex={<ExStructure T={T} />} n={3} title={names.structure || "Cấu trúc giá"}
            why="Xu hướng tăng thật sự tạo ra các đỉnh sau cao hơn đỉnh trước (Higher High) và đáy sau cao hơn đáy trước (Higher Low). Đây là cách nhìn xu hướng trực tiếp từ giá, không qua đường trung bình nào.">
            <p style={p}>
              Tìm các <b>đỉnh/đáy xác nhận</b> (pivot): một nến là đỉnh nếu giá cao của nó cao nhất trong {T.pivot_window} nến
              mỗi bên; đáy tương tự. Lấy 2 đỉnh và 2 đáy gần nhất, xét theo thứ tự:
            </p>
            <ul style={ul}>
              <Sig v={1}>Giá đã vượt đỉnh gần nhất (phá kháng cự).</Sig>
              <Sig v={-1}>Giá đã thủng đáy gần nhất (thủng hỗ trợ).</Sig>
              <Sig v={1}>Đỉnh sau cao hơn đỉnh trước và đáy sau cao hơn đáy trước (HH/HL).</Sig>
              <Sig v={-1}>Đỉnh sau thấp hơn và đáy sau thấp hơn (LH/LL).</Sig>
              <Sig v={0}>Lẫn lộn (ví dụ đỉnh cao hơn nhưng đáy thấp hơn).</Sig>
            </ul>
          </Criterion>

          <Criterion id="momentum" ex={<ExMomentum T={T} />} n={4} title={names.momentum || "Động lượng (RSI + MACD)"}
            why="Xu hướng là hướng đi, động lượng là tốc độ và độ mạnh của bước đi. Giá vẫn tăng nhưng động lượng yếu dần thường là dấu hiệu sớm của việc chững lại. Tiêu chí này dùng hai chỉ báo quen thuộc: RSI và MACD.">
            <p style={p}><b>Phần RSI(14)</b>: RSI đo tỉ lệ nến tăng so với nến giảm gần đây, thang 0–100.</p>
            <ul style={ul}>
              <Sig v={1}>RSI ≥ {T.rsi_mid} và cao hơn 3 nến trước (đang mạnh lên).</Sig>
              <Sig v={0.5}>Như trên nhưng RSI ≥ {T.rsi_overbought} (quá mua, dễ điều chỉnh, nên chỉ cho một nửa).</Sig>
              <Sig v={-1}>RSI &lt; {T.rsi_mid} và thấp hơn 3 nến trước.</Sig>
              <Sig v={-0.5}>Như trên nhưng RSI ≤ {T.rsi_oversold} (quá bán, dễ hồi).</Sig>
              <Sig v={0}>Các trường hợp còn lại.</Sig>
            </ul>
            <p style={p}><b>Phần MACD(12, 26, 9)</b>: dùng histogram, tức khoảng cách giữa đường MACD và đường tín hiệu.</p>
            <ul style={ul}>
              <Sig v={1}>Histogram dương và đang mở rộng (lớn hơn nến trước).</Sig>
              <Sig v={0.5}>Histogram dương nhưng thu hẹp.</Sig>
              <Sig v={-1}>Histogram âm và đang mở rộng về phía âm.</Sig>
              <Sig v={-0.5}>Histogram âm nhưng thu hẹp.</Sig>
            </ul>
            <p style={p}>Tín hiệu của tiêu chí = <b>trung bình cộng</b> của phần RSI và phần MACD.</p>
          </Criterion>

          <Criterion id="volume" ex={<ExVolume T={T} />} n={5} title={names.volume || "Volume xác nhận"}
            why="Giá tăng mà khối lượng giao dịch thấp thì dễ là tăng 'ảo'. Khi các nến tăng có khối lượng áp đảo các nến giảm, nghĩa là bên mua thực sự đang bỏ tiền vào.">
            <p style={p}>
              Trong {T.vol_lookback} nến gần nhất, cộng khối lượng của các <b>nến xanh</b> (đóng ≥ mở) và các <b>nến đỏ</b>:
            </p>
            <ul style={ul}>
              <Sig v={1}>Volume nến xanh ≥ {T.vol_ratio}× volume nến đỏ.</Sig>
              <Sig v={-1}>Volume nến đỏ ≥ {T.vol_ratio}× volume nến xanh.</Sig>
              <Sig v={0}>Không bên nào áp đảo.</Sig>
            </ul>
          </Criterion>

          <Criterion id="derivatives" ex={<ExDerivatives T={T} />} n={6} title={names.derivatives || "Phái sinh (OI + Funding)"}
            why="Phần lớn khối lượng crypto nằm ở hợp đồng futures. Open Interest (OI) là tổng số hợp đồng đang mở: OI tăng nghĩa là có tiền mới vào lệnh. Funding là phí bên long và bên short trả cho nhau mỗi 8 giờ: funding cao nghĩa là phe long đang quá đông, dễ bị 'xả'.">
            <p style={p}>Dùng % thay đổi OI trong {T.vol_lookback} kỳ, % thay đổi giá trong {T.vol_lookback} nến, và funding gần nhất. Xét theo thứ tự:</p>
            <ul style={ul}>
              <Sig v={-1}>Funding ≥ {T.funding_hot}%: long quá đông.</Sig>
              <Sig v={-1}>OI tăng ≥ {T.oi_change_pct}% trong khi giá giảm: phe short đang mở thêm lệnh.</Sig>
              <Sig v={1}>OI tăng ≥ {T.oi_change_pct}% cùng lúc giá tăng, và funding ≤ {T.funding_ok_max}%: tiền mới vào lệnh tăng mà chưa quá nóng.</Sig>
              <Sig v={0}>Các trường hợp còn lại.</Sig>
            </ul>
            <p style={muted}>Coin không có futures trên Binance: "Thiếu dữ liệu", không tính vào điểm.</p>
          </Criterion>

          <Criterion id="btc" ex={<ExBtc T={T} />} n={7} title={names.btc || "Bối cảnh BTC"}
            why="Phần lớn altcoin chạy theo Bitcoin: khi BTC giảm mạnh, rất ít coin đi ngược được. Backtest của trang cho thấy đây là tiêu chí có sức dự báo tốt nhất ở khung 4H trở lên.">
            <p style={p}>Áp dụng cách tính của tiêu chí 2 (Xu hướng EMA) cho <b>BTC/USDT cùng khung thời gian</b>.</p>
            <p style={muted}>Khi đang phân tích chính BTC: tiêu chí này không có, trọng số của nó được chia lại theo tỉ lệ cho 7 tiêu chí còn lại.</p>
          </Criterion>

          <Criterion id="liquidation" ex={<ExLiquidation T={T} />} n={8} title={names.liquidation || "Vùng thanh lý (ước tính)"}
            why="Khi giá chạm mức thanh lý của một nhóm lệnh đòn bẩy, sàn buộc đóng các lệnh đó, tạo ra lệnh mua/bán dồn dập. Vì vậy giá hay bị 'hút' về những vùng tập trung nhiều lệnh chờ thanh lý, như một nam châm.">
            <p style={p}>
              Binance không công bố vị trí các lệnh, nên đây là <b>mô hình ước tính</b> (như các heatmap công khai khác):
            </p>
            <ul style={ul}>
              <li>Mỗi lần OI tăng trong một nến được coi là có lệnh mới mở ở giá trung bình của nến đó. Mỗi hợp đồng mới luôn có hai bên: một người long và một người short.</li>
              <li>Lệnh mới được chia theo đòn bẩy giả định 10x / 25x / 50x / 100x (5% / 20% / 40% / 35%). Lệnh long đòn bẩy L bị thanh lý gần <C>giá vào × (1 − 1/L + 0.4%)</C>, lệnh short gần <C>giá vào × (1 + 1/L − 0.4%)</C>.</li>
              <li>Mức nào đã bị giá chạm qua thì coi như đã thanh lý và bị xoá. OI giảm thì mọi mức còn lại giảm theo tỉ lệ.</li>
              <li>
                <b>Lực hút</b> mỗi phía = tổng tiền chờ thanh lý ÷ khoảng cách tới giá (%), trong phạm vi ±{T.liq_range_pct}%.
                Short chờ phía trên hút giá <i>lên</i> (khi bị thanh lý họ phải mua), long chờ phía dưới hút giá <i>xuống</i>.
              </li>
            </ul>
            <p style={p}>Gọi chênh lệch = (lực hút lên − lực hút xuống) ÷ tổng:</p>
            <ul style={ul}>
              <Sig v={1}>Chênh lệch ≥ {Math.round(2 * T.liq_imbalance * 100) / 100} về phía lên.</Sig>
              <Sig v={0.5}>Chênh lệch ≥ {T.liq_imbalance} về phía lên.</Sig>
              <Sig v={0}>Chênh lệch nhỏ hơn {T.liq_imbalance}.</Sig>
              <Sig v={-0.5}>Chênh lệch ≥ {T.liq_imbalance} về phía xuống.</Sig>
              <Sig v={-1}>Chênh lệch ≥ {Math.round(2 * T.liq_imbalance * 100) / 100} về phía xuống.</Sig>
            </ul>
            <p style={muted}>Lưu ý: giá thường quét qua cụm thanh lý rồi <b>đảo chiều</b>, nên đây là nơi giá có thể tới, không phải nơi giá sẽ dừng lại.</p>
          </Criterion>
        </section>

        <section id="g-score" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Cách tính điểm</h2>
          <p style={p}>
            Mỗi tiêu chí cho một <b>tín hiệu</b>: <C>+1</C> là tăng rõ, <C>+0.5</C> là tăng một phần, <C>0</C> là trung tính,
            <C>−0.5</C> và <C>−1</C> tương tự cho phía giảm. Tiêu chí nào không có dữ liệu (ví dụ coin không có hợp đồng
            futures) sẽ ghi "Thiếu dữ liệu" và <b>không được tính</b>, thay vì bị coi là 0.
          </p>
          <p style={p}>Mỗi tiêu chí có một <b>trọng số</b> (độ quan trọng). Điểm cuối cùng là trung bình có trọng số:</p>
          <p style={{ ...p, fontFamily: "var(--font-mono)", fontSize: 14, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
            Điểm = 100 × Σ(trọng số × tín hiệu) ÷ Σ(trọng số của các tiêu chí có dữ liệu)
          </p>
          <p style={p}>
            Ví dụ: chỉ có 2 tiêu chí, trọng số 20 với tín hiệu +1 và trọng số 10 với tín hiệu −0.5. Điểm = 100 × (20 − 5) ÷ 30 = <b>+50</b>.
          </p>
          <p style={p}>Từ điểm ra kết luận:</p>
          <ul style={ul}>
            <li><b>≥ +{T.score_strong}</b>: Xu hướng tăng mạnh · <b>≥ +{T.score_lean}</b>: Nghiêng tăng</li>
            <li><b>≤ −{T.score_strong}</b>: Xu hướng giảm mạnh · <b>≤ −{T.score_lean}</b>: Nghiêng giảm</li>
            <li>Ở giữa: Trung tính</li>
            <li>
              <b>Ngoại lệ "Đi ngang":</b> nếu chỉ báo <b>ADX(14)</b> dưới <b>{T.adx_trend_min}</b>, kết luận luôn là "Đi ngang,
              chưa có xu hướng", bất kể điểm. ADX đo <i>độ mạnh</i> của xu hướng (không quan tâm lên hay xuống); ADX thấp
              nghĩa là giá đang lình xình, và các tín hiệu xu hướng lúc đó rất dễ sai.
            </li>
          </ul>
        </section>

        <section id="g-warn" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Các cảnh báo (không cộng trừ điểm)</h2>
          <ul style={ul}>
            <li><b>RSI quá mua / quá bán</b> (≥ {T.rsi_overbought} hoặc ≤ {T.rsi_oversold}): dễ điều chỉnh hoặc hồi kỹ thuật dù xu hướng vẫn còn.</li>
            <li><b>Funding âm</b> (≤ −{T.funding_ok_max}%): phe short đông, có thể xảy ra short squeeze (giá tăng vọt ép short đóng lệnh).</li>
            <li><b>Khung lớn ngược chiều khung hiện tại</b>: tín hiệu kém tin cậy hơn.</li>
            <li><b>Cụm thanh lý lớn nhất cách giá dưới 1%</b>: giá có thể quét nhanh tới đó rồi đảo chiều, cẩn thận đặt stop gần đó.</li>
            <li><b>Khung 5m, 15m, 30m</b>: backtest cho thấy ở các khung này không tiêu chí nào dự báo được giá vài nến tới. Hãy xem điểm như mô tả xu hướng hiện tại.</li>
          </ul>
        </section>

        <section id="g-weights" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Trọng số đến từ đâu?</h2>
          <p style={p}>
            Trọng số <b>không đặt theo cảm tính</b>. Trang chạy lại (backtest) chính các tiêu chí này trên lịch sử của 10 coin
            lớn (BTC, ETH, SOL, XRP, LTC, BNB, DOGE, ADA, LINK, AVAX), xem tiêu chí nào thật sự đi trước giá 5 nến sau đó, rồi
            cho tiêu chí đó trọng số cao hơn. Có <b>hai bộ trọng số</b>: một cho khung 5m–1H, một cho khung 4H–1D, vì hai nhóm
            khung hoạt động rất khác nhau.
          </p>
          <p style={p}>
            Mỗi sáng Chủ nhật hệ thống tự backtest lại. Trọng số chỉ thay đổi khi bộ mới tốt hơn bộ cũ trên phần dữ liệu nó
            chưa từng thấy, và mỗi lần mỗi tiêu chí chỉ đổi tối đa 3 điểm, để tránh chạy theo nhiễu.
          </p>
          {sets && (
            <div style={{ overflowX: "auto", margin: "4px 0 12px" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 520 }}>
                <caption style={{ ...muted, textAlign: "left", margin: "0 0 6px" }}>Trọng số đang dùng</caption>
                <thead><tr><th style={th}>Tiêu chí</th><th style={{ ...th, textAlign: "right" }}>5m–1H</th><th style={{ ...th, textAlign: "right" }}>4H–1D</th></tr></thead>
                <tbody>
                  {CRITERIA.map(k => (
                    <tr key={k}>
                      <td style={td}>{names[k] || k}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)" }}>{sets.short?.[k]}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)" }}>{sets.long?.[k]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cfg === false && <p style={muted}>Không tải được trọng số hiện tại; bạn xem trong bảng tiêu chí ngay dưới kết luận.</p>}
          <p style={p}>
            Bạn có thể tự chỉnh mọi ngưỡng và trọng số trong mục <b>"Ngưỡng và trọng số (chỉnh được)"</b> ở cuối trang phân
            tích. Giá trị bạn chỉnh được lưu trong trình duyệt của bạn; bấm "Khôi phục mặc định" để quay về bộ tự động.
          </p>
        </section>

        <section id="g-bottoms" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Dấu hiệu đáy</h2>
          <p style={p}>
            Ô <b>"Dấu hiệu đáy"</b> (dưới bản đồ thanh lý) trả lời câu hỏi: giá đang ở đáy, đáy này có giữ được không? Ô này
            không phụ thuộc khung bạn đang chọn mà luôn xét 3 tầm: <b>ngắn hạn</b> (nến 4H), <b>trung hạn</b> (nến 1D) và
            <b> chu kỳ</b> (nến tuần).
          </p>
          <h3 style={h3}>4 dấu hiệu đáy (đọc ở nến đã đóng gần nhất)</h3>
          <ul style={ul}>
            <li><b>RSI quá bán</b>: RSI(14) ≤ 30 trong 3 nến gần nhất. Giá đã bị bán quá đà.</li>
            <li><b>Phân kỳ tăng RSI</b>: giá tạo đáy thấp hơn đáy trước, nhưng RSI tạo đáy cao hơn (đáy RSI trước dưới 40, hai đáy cách nhau tối đa 40 nến, đáy mới xác nhận trong 15 nến gần nhất). Giá còn giảm nhưng lực bán yếu dần.</li>
            <li><b>MACD âm nhưng đang hồi</b>: đường MACD dưới 0 và histogram tăng 2 nến liên tiếp. Đà giảm đang chậm lại.</li>
            <li><b>Nến bán tháo</b>: trong 5 nến gần nhất có một nến đỏ với volume ≥ 2 lần trung bình 20 nến trước đó. Người bán hoảng loạn, thường xảy ra gần cuối một nhịp giảm.</li>
          </ul>
          <h3 style={h3}>Tỉ lệ % được tính thế nào?</h3>
          <p style={p}>
            <b>"Ở đáy 7 ngày"</b> nghĩa là mức thấp nhất trong 1 ngày qua (6 nến 4H) cũng là mức thấp nhất của 7 ngày. Đáy đó
            <b> "giữ được"</b> nếu trong 7 ngày sau giá không xuống thấp hơn. Trung hạn tính tương tự trên nến 1D: đáy của 7 ngày
            gần nhất là thấp nhất 60 ngày, và không bị thủng trong 60 ngày sau.
          </p>
          <p style={p}>
            Trang đã đếm lại mọi lần như vậy trên lịch sử 10 coin lớn từ 2017, chia theo số dấu hiệu đáy có lúc đó. Con số bạn
            thấy là kết quả của nhóm có cùng số dấu hiệu với hiện tại. Bảng được đo lại mỗi sáng Chủ nhật cùng lúc với trọng số,
            và chỉ thay khi đủ mẫu và thứ tự hợp lý (0 dấu hiệu thấp nhất, 3–4 dấu hiệu cao nhất):
          </p>
          {cfg?.bottoms && (
            <div style={{ margin: "4px 0 12px" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 520 }}>
                <caption style={{ ...muted, textAlign: "left", margin: "0 0 6px" }}>
                  Tỉ lệ đáy giữ được theo số dấu hiệu
                  {cfg.bottoms.updated_at ? ` · đo ngày ${new Date(String(cfg.bottoms.updated_at).endsWith("Z") ? cfg.bottoms.updated_at : cfg.bottoms.updated_at + "Z").toLocaleDateString("vi-VN")}` : ""}
                </caption>
                <thead><tr><th style={th}>Số dấu hiệu</th><th style={{ ...th, textAlign: "right" }}>Ngắn hạn (4H, 7 ngày)</th><th style={{ ...th, textAlign: "right" }}>Trung hạn (1D, 60 ngày)</th></tr></thead>
                <tbody>
                  {[0, 1, 2, 3].map(k => (
                    <tr key={k}>
                      <td style={td}>{k === 3 ? "3–4" : k}</td>
                      {["short", "mid"].map(h => (
                        <td key={h} style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                          {Math.round(cfg.bottoms.rates[h][k] * 100)}% <span style={{ color: "var(--text-muted)", fontSize: 12 }}>({cfg.bottoms.samples[h][k]} lần)</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...td, color: "var(--text-muted)" }}>Mọi lần ở đáy</td>
                    {["short", "mid"].map(h => <td key={h} style={{ ...td, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{Math.round(cfg.bottoms.base[h] * 100)}%</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p style={p}>
            Cách đọc: nhìn chung càng nhiều dấu hiệu thì đáy càng hay giữ được. Ở cả nửa dữ liệu cũ lẫn nửa dữ liệu mới, nhóm 0
            dấu hiệu luôn thấp nhất và nhóm 3–4 dấu hiệu luôn cao nhất. Nhưng ngay cả khi
            có 3–4 dấu hiệu, khoảng một nửa (trung hạn) đến gần hai phần ba (ngắn hạn) số đáy vẫn bị thủng. Khi giá không ở đáy,
            ô hiển thị "—" cùng khoảng cách tới đáy gần nhất: tỉ lệ chỉ áp dụng khi giá đang ở đáy.
          </p>
          <h3 style={h3}>Đáy chu kỳ (nến tuần)</h3>
          <p style={p}>
            Đáy chu kỳ là đáy lớn sau cả một mùa giảm giá (với BTC: 12/2018 và 11/2022). Lịch sử Binance mới có 2 lần như vậy, quá
            ít để tính tỉ lệ, nên trang chỉ <b>đếm 5 điều kiện</b> thường thấy ở các đáy đó:
          </p>
          <ul style={ul}>
            <li>Giá thấp hơn đỉnh cao nhất (trên Binance) từ 70% trở lên.</li>
            <li>RSI tuần ≤ 30 trong 8 tuần gần nhất.</li>
            <li>Giá dưới MA200 tuần (trung bình giá đóng 200 tuần; cần đủ 200 tuần dữ liệu).</li>
            <li>Có tuần bán tháo: tuần đỏ với volume ≥ 2 lần trung bình 20 tuần, trong 8 tuần gần nhất.</li>
            <li>MACD tuần dưới 0 nhưng histogram đang tăng.</li>
          </ul>
          <p style={muted}>
            Kiểm tra lại trên lịch sử: BTC đạt 4/5 điều kiện trong các tuần quanh đáy 12/2018 và nhiều tuần từ 6 đến 12/2022 (đáy
            thật là 11/2022). Checklist chỉ ra <b>vùng đáy</b>, không chỉ đúng tuần đáy. Với altcoin, điều kiện "giảm ≥ 70%" hay
            đúng trong nhiều năm vì ít altcoin quay lại đỉnh cũ, nên checklist dễ báo sớm.
          </p>
        </section>

        <section id="g-limits" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Giới hạn cần biết</h2>
          <ul style={ul}>
            <li>Ngay cả ở khung 4H–1D, lợi thế của điểm số là <b>nhỏ</b>: đúng chiều nhiều hơn sai một chút, không phải công cụ chắc thắng.</li>
            <li>Ở khung 5m–30m, điểm số gần như không có sức dự báo.</li>
            <li>Vùng thanh lý là ước tính từ mô hình, không phải lệnh thật.</li>
            <li>Tỉ lệ đáy là thống kê quá khứ trên 10 coin lớn; coin nhỏ hoặc mới niêm yết có thể hành xử khác.</li>
            <li>Tin tức, sự kiện vĩ mô (lãi suất, CPI...) có thể đảo chiều thị trường mà không chỉ báo kỹ thuật nào báo trước.</li>
            <li>Luôn tự đặt điểm cắt lỗ và chỉ dùng số tiền bạn chấp nhận mất. Đây không phải lời khuyên đầu tư.</li>
          </ul>
          <p style={muted}>Có thắc mắc về một kết quả cụ thể? Bấm biểu tượng trợ lý AI ở góc dưới bên phải và hỏi, ví dụ "Vì sao điểm đang âm?".</p>
        </section>
      </main>
    </div>
  );
}
