"""DeepSeek client request shape + AI settings fallback (no network, no MongoDB)."""
import os

os.environ.setdefault("MONGODB_URL", "mongodb://localhost:1")
os.environ.setdefault("JWT_SECRET", "test-secret")

import asyncio
import json

import httpx
import pytest

import database
import deepseek


def run(coro):
    return asyncio.run(coro)


def test_deepseek_request_and_reply(monkeypatch):
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "xin chào"}}]})

    real = httpx.AsyncClient
    monkeypatch.setattr(deepseek.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(deepseek, "DEEPSEEK_API_KEY", "sk-test")
    reply = run(deepseek.deepseek_chat("SYS", [{"role": "user", "content": "hi"}, {"role": "x", "content": "y"}], "deepseek-flash"))
    assert reply == "xin chào"
    assert seen["url"] == "https://api.deepseek.com/chat/completions"
    assert seen["auth"] == "Bearer sk-test"
    b = seen["body"]
    assert b["model"] == "deepseek-flash" and b["stream"] is False
    assert [m["role"] for m in b["messages"]] == ["system", "user", "user"]


def test_deepseek_without_key_fails_clearly(monkeypatch):
    monkeypatch.setattr(deepseek, "DEEPSEEK_API_KEY", None)
    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        run(deepseek.deepseek_chat("SYS", [], "deepseek-flash"))


@pytest.mark.parametrize("stored,expected", [
    ({"provider": "grok", "grok_model": "grok-3", "gemini_model": "g"}, "deepseek"),  # old setting
    ({"provider": "gemini", "gemini_model": "g"}, "gemini"),
    (None, "deepseek"),
])
def test_ai_settings_provider(monkeypatch, stored, expected):
    async def find_one(*a, **k):
        return stored
    monkeypatch.setattr(database.settings_col, "find_one", find_one)
    s = run(database.get_ai_settings())
    assert s["provider"] == expected and s["deepseek_model"] and "grok_model" not in s
