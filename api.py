from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from typing import List, Dict, Literal, Optional
import asyncio
import time
from database import (get_coins, set_coins, get_admin, set_admin_password,
                      get_ai_settings, set_ai_settings, get_active_weights, get_bottom_rates, get_weights_admin,
                      set_weights_locked, rollback_weights, score_col)
import score_history
from ai import ai_chat
from auth import create_token, verify_admin, check_password, hash_password
from analysis.bottoms import HORIZONS
from analysis.binance import SymbolNotFound, UpstreamError
from analysis.config import CRITERIA_META, THRESHOLD_LABELS, TIMEFRAMES, Thresholds, Weights
from analysis.service import analyze
from backtest.store import GROUPS, group_of

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
    # None = the backtest-driven defaults of the timeframe's group (short 5m-1h / long 4h-1d).
    weights: Optional[Weights] = None

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
    if body.weights is not None:
        weights, info = body.weights, {"source": "custom"}
    else:
        g = group_of(body.timeframe)
        active = (await get_active_weights())[g]
        weights = Weights(**active["weights"])
        info = {"source": "auto", "group": g, "updated_at": active["updated_at"], "origin": active["source"]}
    try:
        rates = await get_bottom_rates()
        d = await analyze(request.app.state.binance, body.symbol, body.timeframe, body.thresholds, weights,
                          bottom_table=rates["table"])
        d["weights_info"] = info
        return d
    except SymbolNotFound as e:
        raise HTTPException(404, f"Không tìm thấy cặp {e} trên Binance. Kiểm tra lại mã coin.") from e
    except UpstreamError as e:
        raise HTTPException(502, "Không kết nối được Binance. Thử lại sau ít phút.") from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

def _bottoms_config(b: dict) -> dict:
    t = b["table"]
    return {"horizons": HORIZONS, "updated_at": b["updated_at"], "source": b["source"],
            "rates": {k: t[k]["rates"] for k in HORIZONS}, "samples": {k: t[k]["samples"] for k in HORIZONS},
            "base": {k: t[k]["base"] for k in HORIZONS}}


@router.get("/api/crypto-analysis/analysis/config")
async def analysis_config():
    return {
        "timeframes": TIMEFRAMES,
        "thresholds": Thresholds().model_dump(),
        "threshold_labels": THRESHOLD_LABELS,
        "weights": Weights().model_dump(),
        "weight_sets": {g: v["weights"] for g, v in (await get_active_weights()).items()},
        "weight_groups": GROUPS,
        "criteria": CRITERIA_META,
        "bottoms": _bottoms_config(await get_bottom_rates()),
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
    "on 13 large coins: on 4h and above the criteria had a small but real edge (strongest: BTC "
    "context, momentum, EMA trend, volume); on 5m-30m none of them predicted the next candles, "
    "so say the score is weak evidence there. The bottom readings are measured hit rates, not "
    "predictions: of the past times a coin sat at a 7-day (4h) or 60-day (1d) low with that many "
    "bottom signs (RSI, MACD, volume), that share of lows held; the cycle checklist is only a "
    "count of conditions (Binance history has two cycle bottoms) and is weaker for altcoins, which "
    "rarely revisit their old high. An ADX below the threshold means "
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
    b = a.get("bottoms") or {}
    for key in ("short", "mid"):
        h = b.get(key)
        if not h:
            continue
        signs = ", ".join(x["name"] for x in h["signs"] if x["ok"]) or "none"
        if h["at_low"]:
            lines.append(f"{h['name']} ({h['tf']}, {h['days']}-day low): price is at it ({h['low']}). {h['count']} bottom signs ({signs}); "
                         f"historically {h['rate']:.0%} of such lows held {h['days']} days (all {h['days']}-day lows: {h['base']:.0%})")
        else:
            lines.append(f"{h['name']} ({h['tf']}): not at a {h['days']}-day low, price {h['above_low_pct']:+.1f}% above it ({h['span_low']}). Bottom signs: {signs}")
    cy = b.get("cycle")
    if cy:
        lines.append(f"Cycle-bottom checklist (weekly): {cy['met']}/{len(cy['conditions'])} met - "
                     + "; ".join(f"{x['name']}: {'yes' if x['ok'] else 'n/a' if x['ok'] is None else 'no'} ({x['detail']})" for x in cy["conditions"]))
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
        raise HTTPException(status_code=429, detail=f"Sai quá nhiều lần. Thử lại sau {mins} phút {secs} giây.")

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
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")
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


# ── Backtest weights ────────────────────────────────────────────────────────────

class WeightsLock(BaseModel):
    locked: bool

class WeightsRollback(BaseModel):
    group: Literal["short", "long"]

@router.get("/api/crypto-analysis/admin/weights")
async def admin_get_weights(_: str = Depends(verify_admin)):
    return await get_weights_admin()

@router.put("/api/crypto-analysis/admin/weights/lock")
async def admin_lock_weights(data: WeightsLock, _: str = Depends(verify_admin)):
    await set_weights_locked(data.locked)
    return {"ok": True}

@router.post("/api/crypto-analysis/admin/weights/rollback")
async def admin_rollback_weights(data: WeightsRollback, _: str = Depends(verify_admin)):
    if not await rollback_weights(data.group):
        raise HTTPException(400, "Không có bộ trọng số trước đó để khôi phục")
    await get_active_weights(force=True)
    return {"ok": True}


# ── Public: score history (recorded every minute for the Admin chart pairs) ────

_history_cache: dict = {}     # (symbol, range) -> (time, data)

@router.get("/api/crypto-analysis/scores")
async def scores(symbol: str, range: Literal["6h", "24h", "7d", "30d", "90d"] = "24h"):
    try:
        sym = score_history.normalize_symbol(symbol)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    hit = _history_cache.get((sym, range))
    if hit and time.time() - hit[0] < 30:
        return hit[1]
    recorded = sym in score_history.symbols_of(await get_coins())
    data = {**await score_history.history(score_col, sym, range), "recorded": recorded}
    if len(_history_cache) > 200:
        _history_cache.clear()
    _history_cache[(sym, range)] = (time.time(), data)
    return data


# ── Admin: run the weekly backtest now ───────────────────────────────────────
# Starts the same systemd unit as the Sunday timer (low priority, survives the browser closing,
# one run at a time). Fixed arguments only: nothing from the request reaches the command.
REWEIGHT_UNIT = "crypto-analysis-reweight.service"

async def _systemctl(*args: str) -> tuple[int, str]:
    try:
        p = await asyncio.create_subprocess_exec("systemctl", *args, stdout=asyncio.subprocess.PIPE,
                                                 stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(p.communicate(), 15)
        return p.returncode, (out or err).decode(errors="replace").strip()
    except (OSError, asyncio.TimeoutError) as e:
        return -1, str(e) or type(e).__name__

async def backtest_state() -> str:
    """"running", "idle", "failed" (last run failed) or "unavailable" (no systemd here)."""
    rc, out = await _systemctl("is-active", REWEIGHT_UNIT)
    if rc == -1 or not out:
        return "unavailable"
    return {"activating": "running", "active": "running", "reloading": "running",
            "failed": "failed"}.get(out, "idle")

@router.get("/api/crypto-analysis/admin/backtest")
async def admin_backtest_state(_: str = Depends(verify_admin)):
    return {"state": await backtest_state()}

@router.post("/api/crypto-analysis/admin/backtest/run")
async def admin_backtest_run(_: str = Depends(verify_admin)):
    state = await backtest_state()
    if state == "running":
        raise HTTPException(409, "Backtest đang chạy")
    if state == "unavailable":
        raise HTTPException(503, "Máy chủ này không có systemd để chạy backtest")
    rc, out = await _systemctl("start", "--no-block", REWEIGHT_UNIT)
    if rc != 0:
        raise HTTPException(503, f"Không khởi động được backtest: {out[:200]}")
    return {"state": "running"}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

@router.put("/api/crypto-analysis/admin/password")
async def admin_change_password(data: PasswordChange, _: str = Depends(verify_admin)):
    admin = await get_admin()
    if not admin or not check_password(data.current_password, admin.get("hashed_password", "")):
        raise HTTPException(status_code=401, detail="Mật khẩu hiện tại không đúng")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu mới phải có ít nhất 6 ký tự")
    await set_admin_password(hash_password(data.new_password))
    return {"ok": True}
