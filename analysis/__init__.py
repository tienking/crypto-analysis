"""Coin trend scoring: Binance market data -> 8 weighted criteria -> score in [-100, 100].

Ported from the standalone coin-analysis app. Pure indicator/criteria code plus an async
Binance client; api.py exposes it under /api/crypto-analysis/analysis/*.
"""
