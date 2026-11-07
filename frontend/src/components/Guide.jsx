import { useEffect, useRef, useState } from "react";
import { fetchAnalysisConfig } from "../lib/api";

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

function Criterion({ id, n, title, why, children }) {
  return (
    <section id={`g-${id}`} style={box} aria-labelledby={`g-${id}-t`}>
      <h3 id={`g-${id}-t`} style={h3}>{n}. {title}</h3>
      <div style={tag}>Vì sao có tiêu chí này</div>
      <p style={p}>{why}</p>
      <div style={tag}>Cách tính</div>
      {children}
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
          {[["g-start", "Trang này làm gì"], ["g-score", "Cách ra điểm"], ["g-criteria", "8 tiêu chí"], ["g-warn", "Cảnh báo"], ["g-weights", "Trọng số"], ["g-limits", "Giới hạn"]].map(([id, t]) => (
            <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              style={{ fontSize: 13, color: "var(--text)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 999, padding: "6px 12px" }}>{t}</a>
          ))}
        </nav>

        <section id="g-start" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Trang này làm gì?</h2>
          <p style={p}>
            Bạn nhập một mã coin (ví dụ BTC) và chọn khung thời gian (5m đến 1D). Trang lấy dữ liệu công khai của
            Binance rồi chấm <b>8 tiêu chí</b>, mỗi tiêu chí trả lời một câu hỏi: xu hướng đang lên hay xuống, lực mua
            có xác nhận không, dòng tiền phái sinh đang nghiêng về đâu... Kết quả gộp lại thành <b>một điểm từ −100 đến +100</b>.
          </p>
          <p style={p}>
            Điểm dương nghĩa là phần lớn tín hiệu đang nghiêng về <b style={{ color: "var(--up)" }}>tăng</b>, điểm âm là
            nghiêng về <b style={{ color: "var(--down)" }}>giảm</b>. Đây là bản tóm tắt chỉ báo kỹ thuật, <b>không phải dự đoán
            chắc chắn và không phải lời khuyên đầu tư</b>.
          </p>
          <p style={muted}>
            Một vài thuật ngữ: <b>nến</b> là một khoảng thời gian (khung 4H thì mỗi nến là 4 giờ) với giá mở, cao, thấp,
            đóng. <b>EMA</b> là đường giá trung bình có trọng số, nghiêng về các nến gần đây. <b>Khung lớn</b> là khung
            dài hơn khung bạn đang xem, dùng để nhìn bức tranh rộng hơn.
          </p>
        </section>

        <section id="g-score" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Điểm được tính thế nào?</h2>
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

        <section id="g-criteria" style={{ display: "grid", gap: 14, scrollMarginTop: 80 }}>
          <h2 style={h2}>8 tiêu chí</h2>

          <Criterion id="htf" n={1} title={names.htf || "Đồng thuận khung lớn"}
            why="Xu hướng trên khung dài thường bền hơn khung ngắn. Một tín hiệu tăng ở khung 1H mà khung 4H đang giảm mạnh thì dễ chỉ là một nhịp hồi. Tiêu chí này hỏi: bức tranh lớn có ủng hộ không?">
            <p style={p}>Áp dụng đúng cách tính của tiêu chí 2 (Xu hướng EMA), nhưng trên <b>khung lớn hơn</b>:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 10px" }}>
              {HIGHER.map(([a, b]) => <C key={a}>{a} → {b}</C>)}
            </div>
            <p style={muted}>Nến khung lớn đang chạy dở cũng được tính, với giá hiện tại làm giá đóng.</p>
          </Criterion>

          <Criterion id="trend" n={2} title={names.trend || "Xu hướng EMA"}
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

          <Criterion id="structure" n={3} title={names.structure || "Cấu trúc giá"}
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

          <Criterion id="momentum" n={4} title={names.momentum || "Động lượng (RSI + MACD)"}
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

          <Criterion id="volume" n={5} title={names.volume || "Volume xác nhận"}
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

          <Criterion id="derivatives" n={6} title={names.derivatives || "Phái sinh (OI + Funding)"}
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

          <Criterion id="btc" n={7} title={names.btc || "Bối cảnh BTC"}
            why="Phần lớn altcoin chạy theo Bitcoin: khi BTC giảm mạnh, rất ít coin đi ngược được. Backtest của trang cho thấy đây là tiêu chí có sức dự báo tốt nhất ở khung 4H trở lên.">
            <p style={p}>Áp dụng cách tính của tiêu chí 2 (Xu hướng EMA) cho <b>BTC/USDT cùng khung thời gian</b>.</p>
            <p style={muted}>Khi đang phân tích chính BTC: "Thiếu dữ liệu", không tính.</p>
          </Criterion>

          <Criterion id="liquidation" n={8} title={names.liquidation || "Vùng thanh lý (ước tính)"}
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

        <section id="g-limits" style={{ scrollMarginTop: 80 }}>
          <h2 style={h2}>Giới hạn cần biết</h2>
          <ul style={ul}>
            <li>Ngay cả ở khung 4H–1D, lợi thế của điểm số là <b>nhỏ</b>: đúng chiều nhiều hơn sai một chút, không phải công cụ chắc thắng.</li>
            <li>Ở khung 5m–30m, điểm số gần như không có sức dự báo.</li>
            <li>Vùng thanh lý là ước tính từ mô hình, không phải lệnh thật.</li>
            <li>Tin tức, sự kiện vĩ mô (lãi suất, CPI...) có thể đảo chiều thị trường mà không chỉ báo kỹ thuật nào báo trước.</li>
            <li>Luôn tự đặt điểm cắt lỗ và chỉ dùng số tiền bạn chấp nhận mất. Đây không phải lời khuyên đầu tư.</li>
          </ul>
          <p style={muted}>Có thắc mắc về một kết quả cụ thể? Bấm biểu tượng trợ lý AI ở góc dưới bên phải và hỏi, ví dụ "Vì sao điểm đang âm?".</p>
        </section>
      </main>
    </div>
  );
}
