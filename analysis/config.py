"""Default thresholds, weights and constants. Users can override per request."""
from __future__ import annotations

from pydantic import BaseModel, Field

TIMEFRAMES = ("5m", "15m", "1h", "4h", "12h", "1d")
# Higher timeframe = roughly 4-7x the current one (Binance has 30m and 3d candles).
HIGHER_TF = {"5m": "30m", "15m": "1h", "1h": "4h", "4h": "1d", "12h": "3d", "1d": "1w"}
QUOTE = "USDT"
BTC_SYMBOL = "BTCUSDT"
CHART_CANDLES = 120
CACHE_TTL_SECONDS = 15
# Open-interest period behind the liquidation map (500 points; Binance keeps 30 days):
# 5m -> ~1.7 days, 15m -> ~5 days, 1h/4h -> ~21 days, 12h (2h points) and 1d (4h) -> 30 days.
LIQ_PERIOD = {"5m": "5m", "15m": "15m", "1h": "1h", "4h": "1h", "12h": "2h", "1d": "4h"}


class Thresholds(BaseModel):
    ema_fast: int = Field(50, ge=5, le=200)
    ema_slow: int = Field(200, ge=20, le=400)
    rsi_mid: float = Field(50, ge=30, le=70, description="RSI above = bullish side")
    rsi_overbought: float = Field(75, ge=55, le=95)
    rsi_oversold: float = Field(25, ge=5, le=45)
    vol_lookback: int = Field(20, ge=5, le=100)
    vol_ratio: float = Field(1.2, ge=1.0, le=5.0)
    oi_change_pct: float = Field(3.0, ge=0, le=100)
    funding_ok_max: float = Field(0.03, description="% per 8h")
    funding_hot: float = Field(0.05, description="% per 8h")
    pivot_window: int = Field(3, ge=2, le=10)
    adx_trend_min: float = Field(20, ge=0, le=50)
    score_strong: float = Field(50, ge=1, le=100)
    score_lean: float = Field(20, ge=1, le=100)
    liq_range_pct: float = Field(5, ge=1, le=15, description="± % around price")
    liq_imbalance: float = Field(0.25, ge=0.05, le=0.9, description="min |up-down|/(up+down)")


class Weights(BaseModel):
    htf: float = Field(20, ge=0)
    trend: float = Field(20, ge=0)
    structure: float = Field(15, ge=0)
    momentum: float = Field(10, ge=0)
    volume: float = Field(10, ge=0)
    derivatives: float = Field(5, ge=0)
    btc: float = Field(10, ge=0)
    liquidation: float = Field(10, ge=0)


CRITERIA_META = {
    "htf": "Đồng thuận khung lớn",
    "trend": "Xu hướng EMA",
    "structure": "Cấu trúc giá",
    "momentum": "Động lượng (RSI + MACD)",
    "volume": "Volume xác nhận",
    "derivatives": "Phái sinh (OI + Funding)",
    "btc": "Bối cảnh BTC",
    "liquidation": "Vùng thanh lý (ước tính)",
}

THRESHOLD_LABELS = {
    "ema_fast": "EMA nhanh (kỳ)",
    "ema_slow": "EMA chậm (kỳ)",
    "rsi_mid": "RSI ranh giới tăng/giảm",
    "rsi_overbought": "RSI quá mua",
    "rsi_oversold": "RSI quá bán",
    "vol_lookback": "Số nến xét volume / OI",
    "vol_ratio": "Tỉ lệ volume áp đảo (×)",
    "oi_change_pct": "OI thay đổi tối thiểu (%)",
    "funding_ok_max": "Funding lành mạnh tối đa (%)",
    "funding_hot": "Funding quá nóng (%)",
    "pivot_window": "Cửa sổ pivot (nến mỗi bên)",
    "adx_trend_min": "ADX tối thiểu để có xu hướng",
    "score_strong": "Điểm 'mạnh' từ",
    "score_lean": "Điểm 'nghiêng' từ",
    "liq_range_pct": "Phạm vi xét vùng thanh lý (±%)",
    "liq_imbalance": "Chênh lệch lực hút tối thiểu (0–1)",
}
