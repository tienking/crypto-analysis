from motor.motor_asyncio import AsyncIOMotorClient
from config import MONGODB_URL, ADMIN_USERNAME, ADMIN_PASSWORD, AI_PROVIDER, DEEPSEEK_MODEL, GEMINI_MODEL

client = AsyncIOMotorClient(MONGODB_URL)
db = client["cryptonews"]
settings_col = db["settings"]
# The old `articles` collection (RSS news, removed) is left alone: its TTL index on
# `published` empties it within ARTICLE_TTL_DAYS (30) of the last fetch.

DEFAULT_COINS = [
    {"label": "BTCUSDT", "symbol": "MEXC:BTCUSDT"},
    {"label": "ETHUSDT", "symbol": "MEXC:ETHUSDT"},
    {"label": "SOLUSDT", "symbol": "MEXC:SOLUSDT"},
    {"label": "TAOUSDT", "symbol": "MEXC:TAOUSDT"},
    {"label": "XRPUSDT", "symbol": "MEXC:XRPUSDT"},
    {"label": "LTCUSDT", "symbol": "MEXC:LTCUSDT"},
]

DEFAULT_AI = {"provider": AI_PROVIDER, "deepseek_model": DEEPSEEK_MODEL, "gemini_model": GEMINI_MODEL}


# ── Settings: coins / AI / admin (seeded on first run) ─────────────────────────

async def seed_defaults():
    from auth import hash_password
    if not await settings_col.find_one({"type": "coins"}):
        await settings_col.update_one({"type": "coins"}, {"$set": {"list": DEFAULT_COINS}}, upsert=True)
    if not await settings_col.find_one({"type": "ai"}):
        await settings_col.update_one({"type": "ai"}, {"$set": DEFAULT_AI}, upsert=True)
    if not await settings_col.find_one({"type": "admin"}):
        await settings_col.update_one(
            {"type": "admin"},
            {"$set": {"username": ADMIN_USERNAME, "hashed_password": hash_password(ADMIN_PASSWORD)}},
            upsert=True,
        )


async def get_coins():
    d = await settings_col.find_one({"type": "coins"}, {"_id": 0})
    return d["list"] if d else DEFAULT_COINS

async def set_coins(items: list[dict]):
    await settings_col.update_one({"type": "coins"}, {"$set": {"list": items}}, upsert=True)

async def get_admin():
    return await settings_col.find_one({"type": "admin"}, {"_id": 0})

async def set_admin_password(hashed_password: str):
    await settings_col.update_one({"type": "admin"}, {"$set": {"hashed_password": hashed_password}}, upsert=True)

async def get_ai_settings():
    d = await settings_col.find_one({"type": "ai"}, {"_id": 0}) or DEFAULT_AI
    provider = d.get("provider", "deepseek")
    return {
        # Grok was replaced by DeepSeek (v2.3.0): an old "grok" setting falls back to DeepSeek.
        "provider": provider if provider in ("deepseek", "gemini") else "deepseek",
        "deepseek_model": d.get("deepseek_model", DEEPSEEK_MODEL),
        "gemini_model": d.get("gemini_model", GEMINI_MODEL),
    }

async def set_ai_settings(data: dict):
    await settings_col.update_one({"type": "ai"}, {"$set": data}, upsert=True)


# ── Backtest-driven weights (written by backtest/reweight.py, see backtest/store.py) ──

from analysis.config import Weights  # noqa: E402
from backtest.store import DB_NAME as BACKTEST_DB, GROUPS, rollback_target  # noqa: E402

bt_db = client[BACKTEST_DB]
_weights_cache: dict = {"at": 0.0, "value": None}
_WEIGHTS_TTL = 60  # seconds: one DB read per minute, not per analysis


def _clean_weights(w: dict | None) -> dict:
    """Weights() validates and fills fields missing from an older stored set."""
    return Weights(**{k: v for k, v in (w or {}).items() if k in Weights.model_fields}).model_dump()


async def get_active_weights(force: bool = False) -> dict:
    """{group: {"weights", "updated_at", "source"}}; code defaults when nothing is stored."""
    import time as _t
    if not force and _weights_cache["value"] and _t.time() - _weights_cache["at"] < _WEIGHTS_TTL:
        return _weights_cache["value"]
    out = {g: {"weights": Weights().model_dump(), "updated_at": None, "source": "code"} for g in GROUPS}
    try:
        async for d in bt_db["weight_sets"].find({"active": True}):
            if d.get("group") in out:
                out[d["group"]] = {"weights": _clean_weights(d.get("weights")),
                                   "updated_at": d.get("created_at"), "source": d.get("source")}
    except Exception as e:  # noqa: BLE001 — the analysis must work without the backtest DB
        print(f"[weights] using code defaults: {e}")
    _weights_cache.update(at=_t.time(), value=out)
    return out


async def get_weights_admin() -> dict:
    state = await bt_db["state"].find_one({"_id": "weights"}) or {}
    groups = {}
    for g in GROUPS:
        sets = [s async for s in bt_db["weight_sets"].find({"group": g}).sort("created_at", -1).limit(20)]
        groups[g] = {"sets": [{**s, "_id": str(s["_id"]), "run_id": str(s.get("run_id") or "") or None} for s in sets],
                     "can_rollback": rollback_target(sets) is not None}
    runs = [r async for r in bt_db["runs"].find().sort("started_at", -1).limit(10)]
    days = await bt_db["market_5m"].count_documents({"symbol": "BTCUSDT", "oi": {"$exists": True}})
    return {"locked": bool(state.get("locked")), "groups": groups,
            "runs": [{**r, "_id": str(r["_id"])} for r in runs], "oi_days": days}


async def set_weights_locked(locked: bool):
    await bt_db["state"].update_one({"_id": "weights"}, {"$set": {"locked": locked}}, upsert=True)


async def rollback_weights(group: str) -> bool:
    sets = [s async for s in bt_db["weight_sets"].find({"group": group})]
    target = rollback_target(sets)
    if target is None:
        return False
    await bt_db["weight_sets"].update_many({"group": group, "active": True}, {"$set": {"active": False}})
    await bt_db["weight_sets"].update_one({"_id": target["_id"]}, {"$set": {"active": True}})
    _weights_cache["value"] = None
    return True
