import { useState, useEffect } from "react";
import { adminLogin, adminGetCoins, adminSaveCoins, adminGetAi, adminSaveAi, adminChangePassword,
  adminGetWeights, adminLockWeights, adminRollbackWeights, adminBacktestState, adminBacktestRun } from "./lib/api";
import RunsChart from "./components/RunsChart";

const SITE_URL = "/projects/crypto-analysis/";

function getToken() {
  const t = localStorage.getItem("cn_admin_token");
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split(".")[1]));
    if (p.exp * 1000 < Date.now()) { localStorage.removeItem("cn_admin_token"); return null; }
    return t;
  } catch { localStorage.removeItem("cn_admin_token"); return null; }
}

const inp = {
  fontSize: 13, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", outline: "none", fontFamily: "var(--font-display)",
  boxSizing: "border-box", width: "100%",
};

// ── Login ───────────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const { access_token } = await adminLogin(u, p);
      localStorage.setItem("cn_admin_token", access_token);
      onLogin(access_token);
    } catch (e) { setErr(e.message || "Sai tên đăng nhập hoặc mật khẩu."); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ width: 340, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "32px 28px" }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.12em", marginBottom: 8 }}>CRYPTO ANALYSIS · ADMIN</p>
        <h1 style={{ fontSize: 21, fontWeight: 800, marginBottom: 22 }}>Đăng nhập</h1>
        <form onSubmit={submit}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Tên đăng nhập</label>
          <input value={u} onChange={e => setU(e.target.value)} required autoFocus style={{ ...inp, marginBottom: 14 }} />
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Mật khẩu</label>
          <input type="password" value={p} onChange={e => setP(e.target.value)} required style={{ ...inp, marginBottom: err ? 10 : 20 }} />
          {err && <p style={{ fontSize: 12, color: "#f87171", marginBottom: 14 }}>{err}</p>}
          <button type="submit" disabled={loading}
            style={{ width: "100%", padding: 10, borderRadius: 9, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
        <a href={SITE_URL} style={{ display: "inline-block", marginTop: 16, fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>← Về trang chính</a>
      </div>
    </div>
  );
}

// ── Generic 2-field list editor ──────────────────────────────────────────────────

function ListEditor({ title, fields, items, setItems }) {
  const update = (i, key, val) => setItems(items.map((it, idx) => idx === i ? { ...it, [key]: val } : it));
  const remove = (i) => setItems(items.filter((_, idx) => idx !== i));
  const add = () => setItems([...items, Object.fromEntries(fields.map(f => [f.key, ""]))]);

  return (
    <div>
      <h2 style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 12 }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: fields.map(f => f.w).join(" ") + " auto", gap: 8, alignItems: "center" }}>
            {fields.map(f => (
              <input key={f.key} value={it[f.key] || ""} placeholder={f.placeholder}
                onChange={e => update(i, f.key, e.target.value)}
                style={{ ...inp, fontFamily: f.mono ? "var(--font-mono)" : "var(--font-display)" }} />
            ))}
            <button onClick={() => remove(i)} title="Xoá"
              style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 13 }}>✕</button>
          </div>
        ))}
      </div>
      <button onClick={add}
        style={{ marginTop: 10, width: "100%", padding: 9, borderRadius: 9, border: "1px dashed var(--border)", background: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "var(--font-display)" }}>
        + Thêm
      </button>
    </div>
  );
}

// ── Backtest weights ─────────────────────────────────────────────────────────────

const CRITERIA = [["htf", "Khung lớn"], ["trend", "Xu hướng EMA"], ["structure", "Cấu trúc giá"], ["momentum", "Động lượng"],
  ["volume", "Khối lượng"], ["derivatives", "Phái sinh"], ["btc", "Bối cảnh BTC"], ["liquidation", "Thanh lý"]];
const GROUPS = [["short", "5m – 1H"], ["long", "4H – 1D"]];
const MIN_OI_DAYS = 180;
const fmtDate = d => (d ? new Date(String(d).endsWith("Z") ? d : d + "Z").toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const SOURCE = { default: "mặc định", backtest: "backtest", rollback: "khôi phục", code: "mặc định trong code" };
const STATUS = { running: "đang chạy", done: "xong", error: "lỗi" };
const HORIZON = { short: "ngắn hạn", mid: "trung hạn" };
// Reasons are stored in English by the backtest; translate the known ones, keep anything else as is.
const REASONS = {
  "No criterion had a positive IC on the older half: weights kept.": "Không tiêu chí nào có IC dương ở nửa dữ liệu cũ: giữ trọng số.",
  "The proposal equals the current weights.": "Đề xuất trùng với trọng số hiện tại.",
  "The proposal did not beat the current weights on the newer half: weights kept.": "Đề xuất không tốt hơn trọng số hiện tại ở nửa dữ liệu mới: giữ trọng số.",
  "Weights are locked in Admin: proposal not applied.": "Trọng số đang khoá trong Admin: không áp dụng đề xuất.",
  "Beat the current weights on the newer half.": "Tốt hơn trọng số hiện tại ở nửa dữ liệu mới.",
  "Passed the guardrails": "Đạt các điều kiện an toàn",
  "Locked: measured but not applied": "Đang khoá: đã đo nhưng không áp dụng",
};
const reasonVi = r => {
  if (!r) return "";
  if (REASONS[r]) return REASONS[r];
  let m = r.match(/^(\w+): a group has fewer than (\d+) lows$/);
  if (m) return `${HORIZON[m[1]] || m[1]}: có nhóm ít hơn ${m[2]} đáy`;
  m = r.match(/^(\w+): missing data$/);
  if (m) return `${HORIZON[m[1]] || m[1]}: thiếu dữ liệu`;
  m = r.match(/^(\w+): 0 signs is not the lowest rate or 3\+ not the highest$/);
  if (m) return `${HORIZON[m[1]] || m[1]}: 0 dấu hiệu không có tỉ lệ thấp nhất hoặc 3+ không cao nhất`;
  if (r.startsWith("error: ")) return "lỗi: " + r.slice(7);
  return r;
};
const card = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const small = { fontSize: 12, color: "var(--text-muted)" };
const btn = { padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "none", color: "var(--text)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-display)" };

/** Bottom-signal hit rates in use (card "Dấu hiệu đáy"), re-measured by the weekly run. */
function BottomRatesAdmin({ b }) {
  const t = b.active.table, last = b.last;
  const cell = { padding: "4px 0", textAlign: "right", fontFamily: "var(--font-mono)" };
  const fmt = (h, k) => `${Math.round(t[h].rates[k] * 100)}% (${t[h].samples[k]})`;
  return (
    <div style={card}>
      <p style={{ fontSize: 13, fontWeight: 600 }}>Tỉ lệ dấu hiệu đáy</p>
      <p style={{ ...small, margin: "2px 0 10px", lineHeight: 1.5 }}>
        Tỉ lệ các đáy trong quá khứ giữ được, theo số dấu hiệu đáy (số đáy đã đo trong ngoặc). Đo lại mỗi lần chạy
        hằng tuần; bảng mới chỉ được áp dụng khi mỗi nhóm có ≥ 200 đáy, 0 dấu hiệu có tỉ lệ thấp nhất, 3+ cao nhất,
        và trọng số không bị khoá.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", maxWidth: 520, fontSize: 13, borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th style={{ padding: "4px 0", fontWeight: 600 }}>Dấu hiệu</th>
            <th style={{ ...cell, fontFamily: "inherit", fontWeight: 600 }}>Ngắn hạn (4h, 7 ngày)</th>
            <th style={{ ...cell, fontFamily: "inherit", fontWeight: 600 }}>Trung hạn (1d, 60 ngày)</th>
          </tr></thead>
          <tbody>
            {[0, 1, 2, 3].map(k => (
              <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "4px 0" }}>{k === 3 ? "3+" : k}</td>
                <td style={cell}>{fmt("short", k)}</td>
                <td style={cell}>{fmt("mid", k)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}>
              <td style={{ padding: "4px 0" }}>Mọi đáy</td>
              <td style={cell}>{Math.round(t.short.base * 100)}%</td>
              <td style={cell}>{Math.round(t.mid.base * 100)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ ...small, marginTop: 8 }}>
        {b.active.source === "backtest" ? `Áp dụng từ ${fmtDate(b.active.updated_at)}` : "Mặc định trong code (chưa áp dụng bảng nào)"}
        {last ? ` · lần đo gần nhất ${fmtDate(last.created_at)}: ${last.applied ? "đã áp dụng" : "giữ bảng cũ"} (${reasonVi(last.reason)})` : " · chưa đo lần nào"}
      </p>
    </div>
  );
}

function WeightsAdmin({ token, flash }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null); // systemd state of the backtest unit
  const load = () => adminGetWeights(token).then(setD).catch(e => setErr(e.message));
  const loadJob = () => adminBacktestState(token).then(r => setJob(r.state)).catch(() => setJob("unavailable"));
  useEffect(() => { load(); loadJob(); }, [token]);
  // While a run is going: check every 20 s, and reload the results when it ends.
  useEffect(() => {
    if (job !== "running") return undefined;
    const t = setInterval(() => adminBacktestState(token).then(r => {
      setJob(r.state);
      if (r.state !== "running") { load(); flash(r.state === "failed" ? "Backtest lỗi, xem log trên máy chủ" : "✓ Backtest đã xong"); }
    }).catch(() => {}), 20000);
    return () => clearInterval(t);
  }, [job, token]);

  const runNow = async () => {
    if (!window.confirm("Chạy backtest ngay bây giờ? Lần chạy mất khoảng 15–60 phút, chạy nền với mức ưu tiên thấp.")) return;
    setBusy(true);
    try { await adminBacktestRun(token); setJob("running"); flash("✓ Đã bắt đầu chạy backtest"); setTimeout(load, 3000); }
    catch (e) { flash(e.message); loadJob(); }
    setBusy(false);
  };

  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); flash(ok); await load(); } catch (e) { flash(e.message); }
    setBusy(false);
  };

  if (err) return <p style={{ ...small, color: "#f87171" }}>{err}</p>;
  if (!d) return <p style={small}>Đang tải…</p>;
  const lastRun = d.runs[0];
  // minmax(0, 1fr): the wide runs table scrolls inside its card instead of widening the page.
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{d.locked ? "Đang khoá: lần chạy hằng tuần chỉ đề xuất, không áp dụng gì" : "Tự động: lần chạy hằng tuần có thể áp dụng trọng số mới"}</span>
          <span style={small}>
            {lastRun?.deriv_source === undefined ? "Phái sinh và thanh lý: backtest trên lịch sử OI của Bybit từ lần chạy tới"
              : lastRun.deriv_source === "bybit" ? "Phái sinh và thanh lý: backtest trên lịch sử OI của Bybit"
              : lastRun?.deriv_source === "binance" ? "Phái sinh và thanh lý: backtest trên kho OI Binance (Bybit lỗi)"
              : `Phái sinh và thanh lý chưa được backtest (Bybit lỗi, kho OI Binance cần đủ ${MIN_OI_DAYS} ngày)`}
            {` · kho OI Binance: ${d.oi_days} ngày`}
            {lastRun ? ` · lần chạy gần nhất ${fmtDate(lastRun.started_at)} (${STATUS[lastRun.status] || lastRun.status})` : " · chưa chạy lần nào"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={busy || job === "running" || job === "unavailable"} onClick={runNow}
            title={job === "unavailable" ? "Máy chủ này không chạy được backtest (không có systemd)" : "Chạy backtest ngay, không chờ sáng Chủ nhật"}
            style={{ ...btn, opacity: job === "running" || job === "unavailable" ? 0.5 : 1, cursor: job === "running" || job === "unavailable" ? "default" : "pointer" }}>
            {job === "running" ? "Đang chạy backtest…" : "Chạy backtest ngay"}
          </button>
          <button disabled={busy} onClick={() => act(() => adminLockWeights(token, !d.locked), d.locked ? "✓ Đã mở khoá" : "✓ Đã khoá")} style={btn}>
            {d.locked ? "Mở khoá" : "Khoá trọng số"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: 14 }}>
        {GROUPS.map(([g, title]) => {
          const active = d.groups[g].sets.find(s => s.active);
          const canBack = d.groups[g].can_rollback;
          return (
            <div key={g} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
                <button disabled={busy || !canBack} title="Dùng lại bộ trọng số trước đó"
                  onClick={() => act(() => adminRollbackWeights(token, g), `✓ Đã khôi phục ${title}`)}
                  style={{ ...btn, opacity: canBack ? 1 : 0.4, cursor: canBack ? "pointer" : "default" }}>Khôi phục</button>
              </div>
              {active ? (
                <>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <tbody>
                      {CRITERIA.map(([k, name]) => (
                        <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "4px 0" }}>{name}</td>
                          <td style={{ padding: "4px 0", textAlign: "right", fontFamily: "var(--font-mono)" }}>{active.weights[k]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ ...small, marginTop: 8 }}>Áp dụng từ {fmtDate(active.created_at)} · {SOURCE[active.source] || active.source}</p>
                </>
              ) : <p style={small}>Mặc định trong code (chưa chạy lần nào).</p>}
            </div>
          );
        })}
      </div>

      {d.bottoms && <BottomRatesAdmin b={d.bottoms} />}

      <div style={card}>
        <p style={{ fontSize: 13, fontWeight: 600 }}>Điểm backtest qua các lần chạy</p>
        <p style={{ ...small, margin: "2px 0 12px", lineHeight: 1.5 }}>
          IC kiểm tra của bộ trọng số đang dùng sau mỗi lần chạy: điểm khớp với 5 nến tiếp theo tới đâu trên nửa
          dữ liệu mới. ≤ 0 = không có lợi thế · 0,03–0,08 = nhỏ nhưng có thật · trên 0,1 = đáng ngờ (nhiều khả năng do may).
          Các lần chạy liền nhau dùng chung phần lớn dữ liệu, nên hãy xem xu hướng, đừng xem thay đổi của một tuần.
        </p>
        <RunsChart history={d.history || []} />
      </div>

      <div style={card}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Các lần chạy gần đây</p>
        {d.runs.length === 0 ? <p style={small}>Chưa có lần chạy hằng tuần nào.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 520 }}>
              <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <th style={{ padding: "4px 6px 4px 0" }}>Bắt đầu</th><th>Nhóm</th><th>IC kiểm tra hiện tại → đề xuất</th><th>Kết quả</th>
              </tr></thead>
              <tbody>
                {d.runs.flatMap(r => (r.groups ? GROUPS.filter(([g]) => r.groups[g]).map(([g, title]) => {
                  const x = r.groups[g];
                  return (
                    <tr key={r._id + g} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                      <td style={{ padding: "5px 6px 5px 0", whiteSpace: "nowrap" }}>{fmtDate(r.started_at)}</td>
                      <td style={{ whiteSpace: "nowrap", paddingRight: 6 }}>{title}</td>
                      <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap", paddingRight: 6 }}>
                        {x.test_ic_current?.toFixed(3)}{x.test_ic_proposed != null ? ` → ${x.test_ic_proposed.toFixed(3)}` : ""}
                      </td>
                      <td style={{ color: x.applied ? "var(--accent)" : "var(--text-muted)" }}>{x.applied ? "Đã áp dụng" : "Giữ nguyên"} · {reasonVi(x.reason)}</td>
                    </tr>
                  );
                }) : [
                  <tr key={r._id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "5px 6px 5px 0", whiteSpace: "nowrap" }}>{fmtDate(r.started_at)}</td>
                    <td colSpan={3} style={{ color: r.status === "error" ? "#f87171" : "var(--text-muted)" }}>{STATUS[r.status] || r.status}{r.error ? `: ${r.error}` : ""}</td>
                  </tr>,
                ]))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────────

function Dashboard({ token, onLogout }) {
  const [coins, setCoins] = useState([]);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingCoins, setSavingCoins] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [savingPw, setSavingPw] = useState(false);
  const [pwErr, setPwErr] = useState("");
  const [msg, setMsg] = useState("");

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  useEffect(() => {
    Promise.all([adminGetCoins(token), adminGetAi(token)])
      .then(([c, a]) => { setCoins(c); setAi(a); setLoading(false); })
      .catch(() => { localStorage.removeItem("cn_admin_token"); onLogout(); });
  }, [token]);

  const saveAi = async () => {
    setSavingAi(true);
    try { await adminSaveAi(token, ai); flash(`✓ Đã chọn AI ${ai.provider}`); }
    catch { flash("Lưu cài đặt AI thất bại"); }
    setSavingAi(false);
  };

  const saveCoins = async () => {
    setSavingCoins(true);
    try { await adminSaveCoins(token, coins.filter(c => c.label && c.symbol)); flash("✓ Đã lưu danh sách coin"); }
    catch { flash("Lưu danh sách coin thất bại"); }
    setSavingCoins(false);
  };

  const changePassword = async () => {
    setPwErr("");
    if (pw.next.length < 6) { setPwErr("Mật khẩu mới phải có ít nhất 6 ký tự."); return; }
    setSavingPw(true);
    try {
      await adminChangePassword(token, pw.current, pw.next);
      setPw({ current: "", next: "" });
      flash("✓ Đã đổi mật khẩu");
    } catch (e) { setPwErr(e.message || "Đổi mật khẩu thất bại"); }
    setSavingPw(false);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid var(--accent)", borderTopColor: "transparent", animation: "spin .8s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em" }}>CN ADMIN</p>
            <span style={{ color: "var(--border)" }}>·</span>
            <p style={{ fontSize: 14, fontWeight: 600 }}>Crypto Analysis</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {msg && <span style={{ fontSize: 12, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{msg}</span>}
            <a href={SITE_URL} style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>Xem trang →</a>
            <button onClick={onLogout} style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: "var(--font-display)" }}>Đăng xuất</button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px 60px", display: "flex", flexDirection: "column", gap: 40 }}>
        {/* AI provider */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700 }}>Chatbot AI</h1>
            <button onClick={saveAi} disabled={savingAi}
              style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 700, cursor: savingAi ? "default" : "pointer", opacity: savingAi ? 0.7 : 1 }}>
              {savingAi ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
          {ai && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>Nhà cung cấp đang dùng</p>
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                {["deepseek", "gemini"].map(p => (
                  <button key={p} onClick={() => setAi({ ...ai, provider: p })}
                    style={{
                      flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600,
                      fontFamily: "var(--font-display)", textTransform: "capitalize",
                      border: `1px solid ${ai.provider === p ? "var(--accent-border)" : "var(--border)"}`,
                      background: ai.provider === p ? "var(--accent-dim)" : "transparent",
                      color: ai.provider === p ? "var(--accent)" : "var(--text-muted)",
                    }}>
                    {p === "deepseek" ? "DeepSeek" : "Gemini (Google)"}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Model DeepSeek</label>
                  <input value={ai.deepseek_model} onChange={e => setAi({ ...ai, deepseek_model: e.target.value })}
                    placeholder="deepseek-flash" style={{ ...inp, fontFamily: "var(--font-mono)" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Model Gemini</label>
                  <input value={ai.gemini_model} onChange={e => setAi({ ...ai, gemini_model: e.target.value })}
                    placeholder="gemini-2.5-flash" style={{ ...inp, fontFamily: "var(--font-mono)" }} />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Backtest weights */}
        <section style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 14 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700 }}>Trọng số backtest</h1>
            <p style={{ ...small, marginTop: 4 }}>Cập nhật hằng tuần (Chủ nhật 07:15 giờ Việt Nam), chỉ khi bộ mới tốt hơn bộ hiện tại trên nửa dữ liệu mới; mỗi tiêu chí thay đổi tối đa 3 điểm mỗi lần chạy.</p>
          </div>
          <WeightsAdmin token={token} flash={flash} />
        </section>

        {/* Coins */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700 }}>Cặp coin trên biểu đồ</h1>
            <button onClick={saveCoins} disabled={savingCoins}
              style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 700, cursor: savingCoins ? "default" : "pointer", opacity: savingCoins ? 0.7 : 1 }}>
              {savingCoins ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
          <ListEditor title="NHÃN · MÃ TRADINGVIEW" items={coins} setItems={setCoins}
            fields={[
              { key: "label", placeholder: "BTCUSDT", w: "1fr" },
              { key: "symbol", placeholder: "MEXC:BTCUSDT", w: "1.4fr", mono: true },
            ]} />
        </section>

        {/* Change password */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700 }}>Đổi mật khẩu</h1>
            <button onClick={changePassword} disabled={savingPw || !pw.current || !pw.next}
              style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 700, cursor: (savingPw || !pw.current || !pw.next) ? "default" : "pointer", opacity: (savingPw || !pw.current || !pw.next) ? 0.6 : 1 }}>
              {savingPw ? "Đang lưu..." : "Cập nhật"}
            </button>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Mật khẩu hiện tại</label>
              <input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Mật khẩu mới</label>
              <input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })}
                onKeyDown={e => e.key === "Enter" && changePassword()} style={inp} />
            </div>
            {pwErr && <p style={{ gridColumn: "1/-1", fontSize: 12, color: "#f87171", margin: 0 }}>{pwErr}</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function AdminApp() {
  const [token, setToken] = useState(() => getToken());
  const logout = () => { localStorage.removeItem("cn_admin_token"); setToken(null); };
  if (!token) return <Login onLogin={setToken} />;
  return <Dashboard token={token} onLogout={logout} />;
}
