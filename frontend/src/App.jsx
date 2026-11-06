import { useState } from "react";
import MarketChart from "./components/MarketChart";
import Analysis from "./components/Analysis";
import ChatPopup from "./components/ChatPopup";

export default function App() {
  const [request, setRequest] = useState(null);   // coin picked on the chart → analysed below
  const [analysis, setAnalysis] = useState(null); // the analysis on screen → chatbot context

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Crypto<span style={{ color: "var(--accent)" }}>Analysis</span>
          </h1>
          <a href="/projects/crypto-analysis/admin"
            style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 9, padding: "8px 14px", whiteSpace: "nowrap" }}>
            Admin
          </a>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px max(16px, min(24px, 4vw)) 90px" }}>
        <MarketChart onSelect={label => setRequest({ symbol: label, n: Date.now() })} />
        <Analysis request={request} onAnalyzed={setAnalysis} />
      </main>

      <ChatPopup analysis={analysis} />
    </div>
  );
}
