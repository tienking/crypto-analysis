"""Chat provider dispatcher — routes to DeepSeek or Gemini per the active AI settings."""
from database import get_ai_settings
from deepseek import deepseek_chat
from gemini import gemini_chat


async def ai_chat(system_prompt: str, conversation: list[dict]) -> tuple[str, str]:
    """Returns (reply, provider)."""
    s = await get_ai_settings()
    provider = s.get("provider", "deepseek")
    if provider == "gemini":
        reply = await gemini_chat(system_prompt, conversation, s.get("gemini_model", "gemini-2.5-flash"))
    else:
        provider = "deepseek"
        reply = await deepseek_chat(system_prompt, conversation, s.get("deepseek_model", "deepseek-flash"))
    return reply, provider
