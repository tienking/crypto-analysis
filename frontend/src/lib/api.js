const BASE = "/api/crypto-analysis";

// ── Coin analysis ──────────────────────────────────────────────────────────────

export async function fetchAnalysisConfig() {
  const res = await fetch(`${BASE}/analysis/config`);
  if (!res.ok) throw new Error("Không tải được cấu hình");
  return res.json();
}

/** Score one coin. Throws an Error whose message is ready to show (Vietnamese). */
export async function analyzeCoin({ symbol, timeframe, thresholds, weights }) {
  let res;
  try {
    res = await fetch(`${BASE}/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, timeframe, thresholds, weights }),
    });
  } catch {
    throw new Error("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail
        : Array.isArray(data.detail) ? "Giá trị ngưỡng hoặc trọng số không hợp lệ: " + data.detail.map(e => e.loc.slice(-1)[0]).join(", ")
        : `Lỗi máy chủ (${res.status}).`
    );
  }
  return data;
}

/** `analysis` = the coin on screen ({symbol, timeframe, thresholds, weights}); the server recomputes it as context. */
export async function chat(message, history, analysis) {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, analysis: analysis || null }),
  });
  if (!res.ok) throw new Error("Chat request failed");
  return res.json(); // { reply, provider }
}

export async function fetchCoins() {
  const res = await fetch(`${BASE}/coins`);
  if (!res.ok) return [];
  return res.json();
}

// ── Admin ──────────────────────────────────────────────────────────────────────

const authH = (token) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

export async function adminLogin(username, password) {
  const res = await fetch(`${BASE}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 429) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || "Sai quá nhiều lần. Vui lòng thử lại sau.");
  }
  if (!res.ok) throw new Error("Sai tên đăng nhập hoặc mật khẩu");
  return res.json(); // { access_token }
}

export async function adminGetCoins(token) {
  const res = await fetch(`${BASE}/admin/coins`, { headers: authH(token) });
  if (!res.ok) throw new Error("Không tải được dữ liệu");
  return res.json();
}

export async function adminSaveCoins(token, items) {
  const res = await fetch(`${BASE}/admin/coins`, { method: "PUT", headers: authH(token), body: JSON.stringify({ items }) });
  if (!res.ok) throw new Error("Lưu thất bại");
  return res.json();
}

export async function adminGetAi(token) {
  const res = await fetch(`${BASE}/admin/ai-settings`, { headers: authH(token) });
  if (!res.ok) throw new Error("Không tải được dữ liệu");
  return res.json();
}

export async function adminSaveAi(token, settings) {
  const res = await fetch(`${BASE}/admin/ai-settings`, { method: "PUT", headers: authH(token), body: JSON.stringify(settings) });
  if (!res.ok) throw new Error("Lưu thất bại");
  return res.json();
}

export async function adminChangePassword(token, current_password, new_password) {
  const res = await fetch(`${BASE}/admin/password`, { method: "PUT", headers: authH(token), body: JSON.stringify({ current_password, new_password }) });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || "Đổi mật khẩu thất bại");
  }
  return res.json();
}

export async function adminGetWeights(token) {
  const res = await fetch(`${BASE}/admin/weights`, { headers: authH(token) });
  if (!res.ok) throw new Error("Không tải được trọng số");
  return res.json();
}

export async function adminLockWeights(token, locked) {
  const res = await fetch(`${BASE}/admin/weights/lock`, { method: "PUT", headers: authH(token), body: JSON.stringify({ locked }) });
  if (!res.ok) throw new Error("Lưu thất bại");
  return res.json();
}

export async function adminBacktestState(token) {
  const res = await fetch(`${BASE}/admin/backtest`, { headers: authH(token) });
  if (!res.ok) throw new Error("Không đọc được trạng thái backtest");
  return res.json(); // { state: "running" | "idle" | "failed" | "unavailable" }
}

export async function adminBacktestRun(token) {
  const res = await fetch(`${BASE}/admin/backtest/run`, { method: "POST", headers: authH(token) });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || "Không khởi động được backtest");
  }
  return res.json();
}

export async function adminRollbackWeights(token, group) {
  const res = await fetch(`${BASE}/admin/weights/rollback`, { method: "POST", headers: authH(token), body: JSON.stringify({ group }) });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || "Khôi phục thất bại");
  }
  return res.json();
}
