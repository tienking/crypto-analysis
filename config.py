from dotenv import load_dotenv
import os
import secrets

load_dotenv()


def _require(name: str) -> str:
    """Read a mandatory secret from env. Fail loudly if missing/blank —
    never fall back to a guessable default."""
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"Set it in the .env file (see .env.example)."
        )
    return val


MONGODB_URL = _require("MONGODB_URL")

# Chatbot providers. Active provider + per-provider model are stored in MongoDB
# (settings type="ai"); the env vars below are API keys + seed defaults.
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")  # seed default

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")  # seed default

AI_PROVIDER = os.getenv("AI_PROVIDER", "deepseek")      # seed default: deepseek | gemini

# Admin auth. JWT_SECRET is mandatory — a guessable secret lets anyone forge admin
# tokens, so refuse to start without it.
JWT_SECRET = _require("JWT_SECRET")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
# Only used to seed the admin account on first run. If unset, generate a random
# password (printed once) instead of a known default — once seeded, change it in Admin.
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    ADMIN_PASSWORD = secrets.token_urlsafe(16)
    print(f"[config] ADMIN_PASSWORD not set — generated a random seed password: {ADMIN_PASSWORD}")
