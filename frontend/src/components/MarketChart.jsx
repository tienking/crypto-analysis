import { useState, useEffect, useRef } from "react";
import { fetchCoins } from "../lib/api";

const DEFAULT_COINS = [
  { label: "BTCUSDT", symbol: "MEXC:BTCUSDT" },
  { label: "ETHUSDT", symbol: "MEXC:ETHUSDT" },
  { label: "SOLUSDT", symbol: "MEXC:SOLUSDT" },
  { label: "TAOUSDT", symbol: "MEXC:TAOUSDT" },
  { label: "XRPUSDT", symbol: "MEXC:XRPUSDT" },
  { label: "LTCUSDT", symbol: "MEXC:LTCUSDT" },
];

function Widget({ symbol }) {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      interval: "60",          // 1 hour
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",              // candles
      locale: "en",
      autosize: true,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      backgroundColor: "rgba(15,15,15,1)",
      gridColor: "rgba(255,255,255,0.05)",
      withdateranges: true,
      details: false,
    });
    widget.appendChild(script);

    return () => { container.innerHTML = ""; };
  }, [symbol]);

  return <div ref={ref} style={{ height: "100%", width: "100%" }} />;
}

/** `onSelect(label)` runs when a coin is picked, e.g. "BTCUSDT" (the analysis follows the chart). */
export default function MarketChart({ onSelect }) {
  const [coins, setCoins] = useState(DEFAULT_COINS);
  const [coin, setCoin] = useState(DEFAULT_COINS[0]);

  useEffect(() => {
    fetchCoins().then(list => {
      if (Array.isArray(list) && list.length) {
        setCoins(list);
        setCoin(list[0]);
      }
    }).catch(() => {});
  }, []);

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", letterSpacing: "0.06em" }}>MARKET · 1H</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {coins.map(c => (
            <button key={c.label} onClick={() => { setCoin(c); onSelect?.(c.label); }} aria-pressed={coin.label === c.label}
              style={{
                fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                fontFamily: "var(--font-mono)",
                border: `1px solid ${coin.label === c.label ? "var(--accent-border)" : "var(--border)"}`,
                background: coin.label === c.label ? "var(--accent-dim)" : "transparent",
                color: coin.label === c.label ? "var(--accent)" : "var(--text-muted)",
              }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 420 }}>
        <Widget symbol={coin.symbol} />
      </div>
    </div>
  );
}
