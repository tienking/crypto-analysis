"""DeepSeek chat client — OpenAI-compatible API (https://api-docs.deepseek.com)."""
import httpx
from config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL


async def deepseek_chat(system_prompt: str, conversation: list[dict], model: str, temperature: float = 0.5) -> str:
    """conversation = [{role: user|assistant, content}, ...]"""
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY is not set")
    messages = [{"role": "system", "content": system_prompt}] + [
        {"role": ("assistant" if m["role"] == "assistant" else "user"), "content": m["content"]}
        for m in conversation
    ]
    # Generous timeout: models in thinking mode reason before answering.
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(
            DEEPSEEK_BASE_URL,
            headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages, "temperature": temperature, "stream": False},
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
