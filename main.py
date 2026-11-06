from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from analysis.binance import BinanceClient
from api import router
from database import seed_defaults


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_defaults()
    # One shared HTTP client for Binance market data (public endpoints, no key).
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "crypto-analysis/1.0"}) as http:
        app.state.binance = BinanceClient(http)
        yield


app = FastAPI(title="Crypto Analysis API", lifespan=lifespan)
app.include_router(router)
