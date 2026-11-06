import { useState, useRef, useEffect } from "react";
import { chat } from "../lib/api";

// Served from public/, so it needs the app's base path (/projects/crypto-analysis/).
const BOT_ICON = `${import.meta.env.BASE_URL}icons8-bot-100.png`;

function renderMd(text) {
  return String(text).split("\n").map((line, i) => {
    const bullet = /^[*-]\s/.test(line);
    const raw = bullet ? line.slice(2) : line;
    const parts = raw.split(/(\*\*.*?\*\*)/g).map((seg, j) =>
      seg.startsWith("**") && seg.endsWith("**") ? <strong key={j}>{seg.slice(2, -2)}</strong> : seg
    );
    if (bullet) return <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3 }}><span>•</span><span>{parts}</span></div>;
    if (!raw.trim()) return <div key={i} style={{ height: 6 }} />;
    return <div key={i} style={{ marginBottom: 2 }}>{parts}</div>;
  });
}

// The assistant explains the analysis on screen (the server recomputes it as context).
const WELCOME = { role: "assistant", content: "Chào bạn! Mình là trợ lý AI của Crypto Analysis.\nHỏi mình về kết quả phân tích coin đang xem, từng tiêu chí, hoặc kiến thức crypto nói chung." };
const suggestions = coin => [
  `Vì sao ${coin} được chấm điểm như vậy?`,
  "Tiêu chí nào đang kéo điểm xuống?",
  "Funding và Open Interest đang nói gì?",
];

function Bubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 10 }}>
      {!isUser && <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 7 }}>🤖</div>}
      <div style={{ maxWidth: "82%", padding: "8px 12px", fontSize: 13, lineHeight: 1.6, background: isUser ? "var(--accent)" : "var(--bg-card)", border: `1px solid ${isUser ? "transparent" : "var(--border)"}`, borderRadius: isUser ? "13px 13px 3px 13px" : "13px 13px 13px 3px", color: isUser ? "#000" : "var(--text)", wordBreak: "break-word" }}>
        {isUser ? msg.content : renderMd(msg.content)}
      </div>
    </div>
  );
}

/** `analysis` = {symbol, timeframe, thresholds, weights} of the coin on screen, or null. */
export default function ChatPopup({ analysis }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const send = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;
    if (textOverride === undefined) setInput("");
    const history = messages.filter(m => m !== WELCOME).map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const { reply, provider: p } = await chat(text, history, analysis);
      if (p) setProvider(p);
      setMessages(prev => [...prev, { role: "assistant", content: reply || "—" }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Có lỗi xảy ra. Bạn thử lại nhé." }]);
    }
    setLoading(false);
  };

  const canSend = input.trim() && !loading;

  return (
    <>
      {open && (
        <div style={{ position: "fixed", bottom: 84, right: 24, zIndex: 1001, width: "min(400px, calc(100vw - 32px))", height: "min(560px, calc(100vh - 120px))", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 12px 48px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Crypto AI</span>
              {provider && <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textTransform: "capitalize" }}>· {provider}</span>}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Đóng" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px" }}>×</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "14px 12px", overscrollBehavior: "contain" }}>
            {messages.map((m, i) => <Bubble key={i} msg={m} />)}
            {messages.length === 1 && !loading && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, marginLeft: 31 }}>
                {suggestions((analysis?.symbol || "BTC").toUpperCase()).map(s => (
                  <button key={s} onClick={() => send(s)}
                    style={{ fontSize: 12, padding: "5px 11px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-display)" }}>{s}</button>
                ))}
              </div>
            )}
            {loading && (
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginRight: 7 }}>🤖</div>
                <div style={{ padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "13px 13px 13px 3px", color: "var(--text-muted)", fontSize: 13 }}>...</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 7, alignItems: "center", background: "var(--bg-card)" }}>
            <textarea value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={analysis ? `Hỏi về ${analysis.symbol.toUpperCase()}…` : "Hỏi về crypto…"} rows={1}
              style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "var(--font-display)", resize: "none", outline: "none", lineHeight: 1.5, background: "var(--bg)", color: "var(--text)" }} />
            <button onClick={() => send()} disabled={!canSend}
              style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${canSend ? "var(--accent)" : "var(--border)"}`, background: canSend ? "var(--accent)" : "none", color: canSend ? "#000" : "var(--text-muted)", cursor: canSend ? "pointer" : "default", fontSize: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>↑</button>
          </div>
        </div>
      )}

      <button onClick={() => setOpen(o => !o)} aria-label={open ? "Đóng trợ lý AI" : "Mở trợ lý AI"}
        style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1002, width: 50, height: 50, borderRadius: "50%", border: open ? "1px solid var(--border)" : "none", background: open ? "var(--bg-card)" : "var(--accent)", color: open ? "var(--text-muted)" : "#000", fontSize: open ? 22 : 20, cursor: "pointer", boxShadow: open ? "none" : "0 4px 20px rgba(247,147,26,0.4)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .2s" }}>
        {open ? "×" : <img src={BOT_ICON} alt="" width={34} height={34} style={{ display: "block" }} />}
      </button>
    </>
  );
}
