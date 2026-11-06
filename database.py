from motor.motor_asyncio import AsyncIOMotorClient
from config import MONGODB_URL, ADMIN_USERNAME, ADMIN_PASSWORD, AI_PROVIDER, GROK_MODEL, GEMINI_MODEL

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

DEFAULT_AI = {"provider": AI_PROVIDER, "grok_model": GROK_MODEL, "gemini_model": GEMINI_MODEL}


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
    d = await settings_col.find_one({"type": "ai"}, {"_id": 0})
    if not d:
        return DEFAULT_AI
    return {
        "provider": d.get("provider", "grok"),
        "grok_model": d.get("grok_model", GROK_MODEL),
        "gemini_model": d.get("gemini_model", GEMINI_MODEL),
    }

async def set_ai_settings(data: dict):
    await settings_col.update_one({"type": "ai"}, {"$set": data}, upsert=True)
