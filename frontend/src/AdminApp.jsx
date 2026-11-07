import { useState, useEffect } from "react";
import { adminLogin, adminGetCoins, adminSaveCoins, adminGetAi, adminSaveAi, adminChangePassword } from "./lib/api";

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
    } catch (e) { setErr(e.message || "Invalid username or password."); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div style={{ width: 340, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "32px 28px" }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)", letterSpacing: "0.12em", marginBottom: 8 }}>CRYPTO ANALYSIS · ADMIN</p>
        <h1 style={{ fontSize: 21, fontWeight: 800, marginBottom: 22 }}>Sign in</h1>
        <form onSubmit={submit}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Username</label>
          <input value={u} onChange={e => setU(e.target.value)} required autoFocus style={{ ...inp, marginBottom: 14 }} />
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Password</label>
          <input type="password" value={p} onChange={e => setP(e.target.value)} required style={{ ...inp, marginBottom: err ? 10 : 20 }} />
          {err && <p style={{ fontSize: 12, color: "#f87171", marginBottom: 14 }}>{err}</p>}
          <button type="submit" disabled={loading}
            style={{ width: "100%", padding: 10, borderRadius: 9, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <a href={SITE_URL} style={{ display: "inline-block", marginTop: 16, fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>← Back to site</a>
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
            <button onClick={() => remove(i)} title="Remove"
              style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 13 }}>✕</button>
          </div>
        ))}
      </div>
      <button onClick={add}
        style={{ marginTop: 10, width: "100%", padding: 9, borderRadius: 9, border: "1px dashed var(--border)", background: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "var(--font-display)" }}>
        + Add
      </button>
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
    try { await adminSaveAi(token, ai); flash(`✓ AI set to ${ai.provider}`); }
    catch { flash("Failed to save AI settings"); }
    setSavingAi(false);
  };

  const saveCoins = async () => {
    setSavingCoins(true);
    try { await adminSaveCoins(token, coins.filter(c => c.label && c.symbol)); flash("✓ Coins saved"); }
    catch { flash("Failed to save coins"); }
    setSavingCoins(false);
  };

  const changePassword = async () => {
    setPwErr("");
    if (pw.next.length < 6) { setPwErr("New password must be at least 6 characters."); return; }
    setSavingPw(true);
    try {
      await adminChangePassword(token, pw.current, pw.next);
      setPw({ current: "", next: "" });
      flash("✓ Password changed");
    } catch (e) { setPwErr(e.message || "Change failed"); }
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
            <a href={SITE_URL} style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>View site →</a>
            <button onClick={onLogout} style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: "var(--font-display)" }}>Sign out</button>
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
              {savingAi ? "Saving..." : "Save"}
            </button>
          </div>
          {ai && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>Active provider</p>
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
                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>DeepSeek model</label>
                  <input value={ai.deepseek_model} onChange={e => setAi({ ...ai, deepseek_model: e.target.value })}
                    placeholder="deepseek-flash" style={{ ...inp, fontFamily: "var(--font-mono)" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Gemini model</label>
                  <input value={ai.gemini_model} onChange={e => setAi({ ...ai, gemini_model: e.target.value })}
                    placeholder="gemini-2.5-flash" style={{ ...inp, fontFamily: "var(--font-mono)" }} />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Coins */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700 }}>Chart coin pairs</h1>
            <button onClick={saveCoins} disabled={savingCoins}
              style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 700, cursor: savingCoins ? "default" : "pointer", opacity: savingCoins ? 0.7 : 1 }}>
              {savingCoins ? "Saving..." : "Save"}
            </button>
          </div>
          <ListEditor title="LABEL · TRADINGVIEW SYMBOL" items={coins} setItems={setCoins}
            fields={[
              { key: "label", placeholder: "BTCUSDT", w: "1fr" },
              { key: "symbol", placeholder: "MEXC:BTCUSDT", w: "1.4fr", mono: true },
            ]} />
        </section>

        {/* Change password */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h1 style={{ fontSize: 17, fontWeight: 700 }}>Change password</h1>
            <button onClick={changePassword} disabled={savingPw || !pw.current || !pw.next}
              style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#000", fontSize: 13, fontWeight: 700, cursor: (savingPw || !pw.current || !pw.next) ? "default" : "pointer", opacity: (savingPw || !pw.current || !pw.next) ? 0.6 : 1 }}>
              {savingPw ? "Saving..." : "Update"}
            </button>
          </div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Current password</label>
              <input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>New password</label>
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
