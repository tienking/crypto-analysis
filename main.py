import asyncio
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from analysis.binance import BinanceClient
from api import router
from database import get_active_weights, get_coins, score_col, seed_defaults
from score_history import recorder_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_defaults()
    # One shared HTTP client for Binance market data (public endpoints, no key).
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "crypto-analysis/1.0"}) as http:
        app.state.binance = BinanceClient(http)
        task = None
        if os.getenv("SCORE_RECORDER", "1") != "0":     # one uvicorn worker: one recorder
            await score_col.create_index([("symbol", 1), ("day", 1)])
            task = asyncio.create_task(recorder_loop(score_col, app.state.binance, get_coins, get_active_weights))
        yield
        if task:
            task.cancel()


app = FastAPI(title="Crypto Analysis API", lifespan=lifespan)
app.include_router(router)
