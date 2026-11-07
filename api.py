from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from typing import List, Dict, Literal, Optional
import time
from database import (get_coins, set_coins, get_admin, set_admin_password,
                      get_ai_settings, set_ai_settings)
from ai import ai_chat
from auth import create_token, verify_admin, check_password, hash_password
from analysis.binance import SymbolNotFound, UpstreamError
from analysis.config import CRITERIA_META, THRESHOLD_LABELS, TIMEFRAMES, Thresholds, Weights
from analysis.service import analyze

router = APIRouter()


@router.get("/api/crypto-analysis/health")
async def health():
    return {"status": "ok", "service": "crypto-analysis"}


# ── Coin analysis (8 weighted criteria on Binance data) ────────────────────────

Timeframe = Literal["5m", "15m", "30m", "1h", "4h", "12h", "1d"]

class AnalyzeRequest(BaseModel):
    symbol: str = Field(..., min_length=2, max_length=20)
    timeframe: Timeframe = "4h"
    thresholds: Thresholds = Field(default_factory=Thresholds)
    weights: Weights = Field(default_factory=Weights)

# Per-IP request budget for the public endpoints that call Binance (in-memory, resets on
# restart). Each analysis is up to 5 Binance requests; this keeps one visitor from
# burning the server's Binance rate limit.
_ANALYSIS_LIMIT = 30          # requests
_ANALYSIS_WINDOW = 60         # seconds
_analysis_hits: dict = {}     # ip -> [timestamps]

def _check_analysis_rate(ip: str):
    now = time.time()
    if len(_analysis_hits) > 10000:
        for k in [k for k, v in _analysis_hits.items() if not v or v[-1] < now - _ANALYSIS_WINDOW]:
            _analysis_hits.pop(k, None)
    hits = [t for t in _analysis_hits.get(ip, []) if t > now - _ANALYSIS_WINDOW]
    if len(hits) >= _ANALYSIS_LIMIT:
        raise HTTPException(status_code=429, detail="Bạn phân tích quá nhanh. Đợi một phút rồi thử lại.")
    hits.append(now)
    _analysis_hits[ip] = hits

async def _run_analysis(request: Request, body: AnalyzeRequest) -> dict:
    try:
        return await analyze(request.app.state.binance, body.symbol, body.timeframe, body.thresholds, body.weights)
    except SymbolNotFound as e:
        raise HTTPException(404, f"Không tìm thấy cặp {e} trên Binance. Kiểm tra lại mã coin.") from e
    except UpstreamError as e:
        raise HTTPException(502, "Không kết nối được Binance. Thử lại sau ít phút.") from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

@router.get("/api/crypto-analysis/analysis/config")
async def analysis_config():
    return {
        "timeframes": TIMEFRAMES,
        "thresholds": Thresholds().model_dump(),
        "threshold_labels": THRESHOLD_LABELS,
        "weights": Weights().model_dump(),
        "criteria": CRITERIA_META,
    }

@router.post("/api/crypto-analysis/analysis")
async def analysis(body: AnalyzeRequest, request: Request):
    _check_analysis_rate(_client_ip(request))
    return await _run_analysis(request, body)


# ── Chatbot (DeepSeek / Gemini), grounded in the analysis the visitor is looking at ─

class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2000)
    history: Optional[List[Dict[str, str]]] = None
    # The analysis on screen. The server recomputes it (cached 15s) rather than trusting
    # numbers sent by the browser.
    analysis: Optional[AnalyzeRequest] = None

SYSTEM_PROMPT = (
    "You are the AI assistant for 'Crypto Analysis', a site that scores a coin's trend from "
    "-100 to +100 with 8 weighted technical criteria on Binance data: higher-timeframe "
    "agreement, EMA trend, price structure, momentum (RSI + MACD), volume confirmation, "
    "derivatives (open interest + funding), BTC context and estimated liquidation zones. "
    "The liquidation zones are a model built from Binance open-interest history and an assumed "
    "leverage mix (10x-100x), not real order data: price tends to be pulled towards large, close "
    "clusters, but often reverses after sweeping them. The default weights come from a backtest "
    "on 10 large coins: on 4h and above the criteria had a small but real edge (strongest: BTC "
    "context, momentum, EMA trend, volume); on 5m-30m none of them predicted the next candles, "
    "so say the score is weak evidence there. An ADX below the threshold means "
    "'ranging' whatever the score. Explain the analysis below when the user asks about it, and "
    "answer general crypto questions from your own knowledge. Be concise and neutral. Never "
    "give financial advice; when asked whether to buy or sell, explain what the indicators say "
    "and add a brief risk caveat. Reply in the user's language.\n"
)

def _analysis_context(a: dict) -> str:
    i = a["indicators"]
    lines = [
        f"Coin: {a['symbol']} · timeframe {a['timeframe']} (higher timeframe {a['higher_timeframe']}) · data: Binance {a['source']}",
        f"Price {a['price']} ({a['price_change_pct']:+.2f}% over {a['thresholds']['vol_lookback']} candles)",
        f"Score {a['score']:+.1f} / 100 · verdict: {a['verdict']['title']} — {a['verdict']['note']}",
        f"Criteria: {a['counts']['bull']} bullish, {a['counts']['bear']} bearish, {a['counts']['neutral']} neutral, {a['counts']['na']} no data",
    ]
    for c in a["criteria"]:
        sig = "no data" if c["score"] is None else f"signal {c['score']:+g}, {c['points']:+.1f} pts"
        lines.append(f"- {c['name']} (weight {c['weight']:g}): {sig}. Rule: {c['rule']}. Now: {c['detail']}")
    lines.append(
        f"Indicators: RSI {i['rsi']}, ADX {i['adx']}, MACD hist {i['macd_hist']}, EMA fast {i['ema_fast']}, "
        f"EMA slow {i['ema_slow']}, funding {i['funding_pct']}%/8h, OI change {i['oi_change_pct']}%"
    )
    lines += [f"Warning: {w}" for w in a["warnings"]]
    return "\n".join(lines)

@router.post("/api/crypto-analysis/chat")
async def chat(req: ChatRequest, request: Request):
    system = SYSTEM_PROMPT
    if req.analysis:
        try:
            _check_analysis_rate(_client_ip(request))
            a = await _run_analysis(request, req.analysis)
            system += "\n=== ANALYSIS ON SCREEN ===\n" + _analysis_context(a)
        except HTTPException as e:
            system += f"\n(The analysis for {req.analysis.symbol} could not be loaded: {e.detail})"
    conversation = [
        {"role": ("assistant" if m.get("role") == "assistant" else "user"), "content": m.get("content", "")}
        for m in (req.history or [])[-8:]
    ]
    conversation.append({"role": "user", "content": req.message})
    try:
        reply, provider = await ai_chat(system, conversation)
        return {"reply": reply, "provider": provider}
    except Exception as e:
        print(f"[chat] error: {e}")
        return {"reply": "Xin lỗi, trợ lý AI đang tạm thời không phản hồi. Bạn thử lại sau nhé.", "provider": None}


# ── Public: chart coins ─────────────────────────────────────────────────────────

@router.get("/api/crypto-analysis/coins")
async def coins():
    return await get_coins()


# ── Admin ───────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class CoinItem(BaseModel):
    label: str
    symbol: str

class CoinsUpdate(BaseModel):
    items: List[CoinItem]

# Login rate limiting (in-memory, per client IP, resets on restart).
_login_attempts: dict = {}  # ip -> {"count": int, "locked_until": float}
_MAX_ATTEMPTS = 5
_LOCKOUT_SECONDS = 300  # 5 minutes

def _client_ip(request: Request) -> str:
    # Behind nginx the socket peer is always 127.0.0.1; nginx overwrites X-Real-IP
    # with the real $remote_addr, so it can't be spoofed by the client.
    host = request.client.host if request.client else ""
    if host in ("127.0.0.1", "::1"):
        return request.headers.get("x-real-ip") or host
    return host

def _check_login_rate(ip: str):
    entry = _login_attempts.get(ip)
    if entry and entry["locked_until"] > time.time():
        mins, secs = divmod(int(entry["locked_until"] - time.time()), 60)
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {mins}m {secs}s.")

def _record_login_failure(ip: str):
    now = time.time()
    if len(_login_attempts) > 10000:  # drop stale entries so the dict can't grow unbounded
        for k in [k for k, v in _login_attempts.items() if v["locked_until"] < now]:
            _login_attempts.pop(k, None)
    entry = _login_attempts.get(ip)
    if not entry or (entry["locked_until"] and entry["locked_until"] <= now):
        entry = {"count": 0, "locked_until": 0.0}  # fresh window after a lockout expires
    entry["count"] += 1
    if entry["count"] >= _MAX_ATTEMPTS:
        entry["locked_until"] = now + _LOCKOUT_SECONDS
    _login_attempts[ip] = entry

@router.post("/api/crypto-analysis/admin/login")
async def admin_login(req: LoginRequest, request: Request):
    ip = _client_ip(request)
    _check_login_rate(ip)
    admin = await get_admin()
    if not admin or req.username != admin.get("username") or not check_password(req.password, admin.get("hashed_password", "")):
        _record_login_failure(ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    _login_attempts.pop(ip, None)
    return {"access_token": create_token(req.username), "token_type": "bearer"}

@router.get("/api/crypto-analysis/admin/coins")
async def admin_get_coins(_: str = Depends(verify_admin)):
    return await get_coins()

@router.put("/api/crypto-analysis/admin/coins")
async def admin_set_coins(data: CoinsUpdate, _: str = Depends(verify_admin)):
    await set_coins([c.model_dump() for c in data.items])
    return {"ok": True}


class AISettingsUpdate(BaseModel):
    provider: str                # "deepseek" | "gemini"
    deepseek_model: str
    gemini_model: str

@router.get("/api/crypto-analysis/admin/ai-settings")
async def admin_get_ai(_: str = Depends(verify_admin)):
    return await get_ai_settings()

@router.put("/api/crypto-analysis/admin/ai-settings")
async def admin_set_ai(data: AISettingsUpdate, _: str = Depends(verify_admin)):
    provider = data.provider if data.provider in ("deepseek", "gemini") else "deepseek"
    await set_ai_settings({"provider": provider, "deepseek_model": data.deepseek_model.strip() or "deepseek-flash",
                           "gemini_model": data.gemini_model.strip() or "gemini-2.5-flash"})
    return {"ok": True}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

@router.put("/api/crypto-analysis/admin/password")
async def admin_change_password(data: PasswordChange, _: str = Depends(verify_admin)):
    admin = await get_admin()
    if not admin or not check_password(data.current_password, admin.get("hashed_password", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    await set_admin_password(hash_password(data.new_password))
    return {"ok": True}
