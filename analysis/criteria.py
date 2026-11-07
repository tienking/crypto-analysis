"""Weighted criteria. Each criterion returns a signed score in [-1, 1] or None (no data).

+1 = fully bullish, -1 = fully bearish, 0 = neutral, ±0.5 = partial.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from . import indicators as ind
from .config import CRITERIA_META, Thresholds, Weights
from .liquidation import pull


@dataclass
class Candles:
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    time: np.ndarray

    @classmethod
    def from_klines(cls, rows: list) -> "Candles":
        a = np.asarray(rows, dtype=object)
        f = lambda i: a[:, i].astype(float)  # noqa: E731
        return cls(f(1), f(2), f(3), f(4), f(5), a[:, 0].astype(np.int64))

    def __len__(self) -> int:
        return len(self.close)


@dataclass
class CriterionResult:
    id: str
    score: float | None
    rule: str
    detail: str
    weight: float = 0.0
    name: str = ""

    @property
    def status(self) -> str:
        if self.score is None:
            return "na"
        return "bull" if self.score > 0 else "bear" if self.score < 0 else "neutral"


@dataclass
class Context:
    """Everything the criteria need, computed once."""
    c: Candles
    t: Thresholds
    htf: Candles | None = None
    btc: Candles | None = None
    is_btc: bool = False
    funding: float | None = None
    oi_change: float | None = None
    liq: dict | None = None  # liquidation_map() output
    ema_fast: np.ndarray = field(init=False)
    ema_slow: np.ndarray = field(init=False)
    rsi: np.ndarray = field(init=False)
    hist: np.ndarray = field(init=False)
    adx: np.ndarray = field(init=False)
    price_change: float = field(init=False)

    def __post_init__(self):
        cl = self.c.close
        self.ema_fast = ind.ema(cl, self.t.ema_fast)
        self.ema_slow = ind.ema(cl, self.t.ema_slow)
        self.rsi = ind.rsi(cl, 14)
        _, _, self.hist = ind.macd(cl)
        self.adx, _, _ = ind.adx(self.c.high, self.c.low, cl, 14)
        lb = min(self.t.vol_lookback, len(cl) - 1)
        self.price_change = (cl[-1] / cl[-1 - lb] - 1) * 100


def _ok(x) -> bool:
    return x is not None and not (isinstance(x, float) and math.isnan(x))


def money(v: float) -> str:
    a = abs(v)
    for div, unit in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if a >= div:
            return f"${v / div:.1f}{unit}"
    return f"${v:,.0f}"


def fmt(p: float) -> str:
    if not _ok(p):
        return "—"
    a = abs(p)
    d = 2 if a >= 1000 else 3 if a >= 1 else 5 if a >= 0.01 else 8
    return f"{p:,.{d}f}"


def trend_signal(c: Candles, fast: int, slow: int):
    """EMA alignment score on any candle set. Returns (score|None, detail)."""
    ef, es = ind.ema(c.close, fast), ind.ema(c.close, slow)
    px, f_, s_ = c.close[-1], ef[-1], es[-1]
    if not _ok(f_):
        return None, f"Chưa đủ {fast} nến"
    if not _ok(s_):
        rising = len(ef) > 6 and ef[-1] > ef[-6]
        sc = 0.5 if px > f_ and rising else -0.5 if px < f_ and not rising else 0.0
        return sc, f"Giá {fmt(px)} · EMA{fast} {fmt(f_)} (chưa đủ nến cho EMA{slow})"
    detail = f"Giá {fmt(px)} · EMA{fast} {fmt(f_)} · EMA{slow} {fmt(s_)}"
    if px > f_ > s_:
        return 1.0, detail
    if px < f_ < s_:
        return -1.0, detail
    if px > s_ and f_ > s_:
        return 0.5, detail + " (điều chỉnh trong xu hướng tăng)"
    if px < s_ and f_ < s_:
        return -0.5, detail + " (hồi trong xu hướng giảm)"
    return 0.0, detail


def crit_htf(ctx: Context) -> CriterionResult:
    rule = f"Giá vs EMA{ctx.t.ema_fast}/EMA{ctx.t.ema_slow} trên khung lớn hơn"
    if ctx.htf is None or len(ctx.htf) < ctx.t.ema_fast:
        return CriterionResult("htf", None, rule, "Không đủ dữ liệu khung lớn")
    sc, d = trend_signal(ctx.htf, ctx.t.ema_fast, ctx.t.ema_slow)
    return CriterionResult("htf", sc, rule, d)


def crit_trend(ctx: Context) -> CriterionResult:
    sc, d = trend_signal(ctx.c, ctx.t.ema_fast, ctx.t.ema_slow)
    return CriterionResult("trend", sc, f"Giá > EMA{ctx.t.ema_fast} > EMA{ctx.t.ema_slow} (hoặc ngược lại)", d)


def crit_structure(ctx: Context) -> CriterionResult:
    rule = "Higher High + Higher Low, hoặc phá kháng cự / thủng hỗ trợ gần nhất"
    highs, lows = ind.pivots(ctx.c.high, ctx.c.low, ctx.t.pivot_window)
    if len(highs) < 2 or len(lows) < 2:
        return CriterionResult("structure", None, rule, "Chưa đủ đỉnh/đáy để xác định")
    (_, h1), (_, h2) = highs[-2], highs[-1]
    (_, l1), (_, l2) = lows[-2], lows[-1]
    px = ctx.c.close[-1]
    hh, hl, lh, ll = h2 > h1, l2 > l1, h2 < h1, l2 < l1
    shape = f"{'HH' if hh else 'LH'}/{'HL' if hl else 'LL'}"
    detail = f"{shape} · Kháng cự {fmt(h2)} · Hỗ trợ {fmt(l2)}"
    if px > h2:
        return CriterionResult("structure", 1.0, rule, detail + " · Đã phá kháng cự")
    if px < l2:
        return CriterionResult("structure", -1.0, rule, detail + " · Đã thủng hỗ trợ")
    if hh and hl:
        return CriterionResult("structure", 1.0, rule, detail)
    if lh and ll:
        return CriterionResult("structure", -1.0, rule, detail)
    return CriterionResult("structure", 0.0, rule, detail + " · Cấu trúc lẫn lộn")


def crit_momentum(ctx: Context) -> CriterionResult:
    t = ctx.t
    r, r3, h, h1 = ctx.rsi[-1], ctx.rsi[-4], ctx.hist[-1], ctx.hist[-2]
    rule = f"Trung bình của RSI (vs {t.rsi_mid:g}, hướng 3 nến) và MACD histogram (dấu, mở rộng)"
    if not all(_ok(v) for v in (r, r3, h, h1)):
        return CriterionResult("momentum", None, rule, "Chưa đủ nến")
    if r >= t.rsi_mid and r > r3:
        rs = 0.5 if r >= t.rsi_overbought else 1.0
    elif r < t.rsi_mid and r < r3:
        rs = -0.5 if r <= t.rsi_oversold else -1.0
    else:
        rs = 0.0
    if h > 0:
        ms = 1.0 if h > h1 else 0.5
    elif h < 0:
        ms = -1.0 if h < h1 else -0.5
    else:
        ms = 0.0
    detail = f"RSI {r:.1f} (3 nến trước {r3:.1f}) · Hist {h:.4g} (trước {h1:.4g})"
    return CriterionResult("momentum", (rs + ms) / 2, rule, detail)


def crit_volume(ctx: Context) -> CriterionResult:
    t, c = ctx.t, ctx.c
    n = min(t.vol_lookback, len(c))
    o, cl, v = c.open[-n:], c.close[-n:], c.volume[-n:]
    green, red = float(v[cl >= o].sum()), float(v[cl < o].sum())
    rule = f"Vol nến xanh / nến đỏ trong {n} nến ≥ {t.vol_ratio:g}× (hoặc ngược lại)"
    ratio = green / red if red > 0 else math.inf
    detail = f"Xanh {green:,.0f} · Đỏ {red:,.0f} · Tỉ lệ {('∞' if ratio == math.inf else f'{ratio:.2f}×')}"
    if ratio >= t.vol_ratio:
        return CriterionResult("volume", 1.0, rule, detail)
    if ratio <= 1 / t.vol_ratio:
        return CriterionResult("volume", -1.0, rule, detail)
    return CriterionResult("volume", 0.0, rule, detail)


def crit_derivatives(ctx: Context) -> CriterionResult:
    t, f, o, p = ctx.t, ctx.funding, ctx.oi_change, ctx.price_change
    rule = (f"Tăng: OI ≥ +{t.oi_change_pct:g}% cùng giá tăng, funding ≤ {t.funding_ok_max:g}%. "
            f"Giảm: OI tăng khi giá giảm, hoặc funding ≥ {t.funding_hot:g}%")
    if f is None and o is None:
        return CriterionResult("derivatives", None, rule, "Coin không có futures trên Binance")
    detail = (f"OI {('—' if o is None else f'{o:+.2f}%')} · Giá {p:+.2f}% · "
              f"Funding {('—' if f is None else f'{f:.4f}%')}")
    if f is not None and f >= t.funding_hot:
        return CriterionResult("derivatives", -1.0, rule, detail + " · Long quá đông")
    if o is not None and o >= t.oi_change_pct and p < 0:
        return CriterionResult("derivatives", -1.0, rule, detail + " · Short mở thêm")
    if o is not None and o >= t.oi_change_pct and p > 0 and (f is None or f <= t.funding_ok_max):
        return CriterionResult("derivatives", 1.0, rule, detail + " · Dòng tiền mới vào lệnh tăng")
    return CriterionResult("derivatives", 0.0, rule, detail)


def crit_btc(ctx: Context) -> CriterionResult:
    rule = "Xu hướng EMA của BTC cùng khung (altcoin thường đi theo BTC)"
    if ctx.is_btc:
        return CriterionResult("btc", None, rule, "Đang phân tích chính BTC")
    if ctx.btc is None:
        return CriterionResult("btc", None, rule, "Không tải được dữ liệu BTC")
    sc, d = trend_signal(ctx.btc, ctx.t.ema_fast, ctx.t.ema_slow)
    return CriterionResult("btc", sc, rule, "BTC: " + d)


def crit_liquidation(ctx: Context) -> CriterionResult:
    t = ctx.t
    rule = (f"Giá hay bị hút về cụm thanh lý lớn và gần (±{t.liq_range_pct:g}%). Tăng: cụm short phía trên "
            f"hút mạnh hơn cụm long phía dưới, chênh ≥ {t.liq_imbalance:g} (và ngược lại)")
    if ctx.liq is None:
        return CriterionResult("liquidation", None, rule, "Không có lịch sử OI futures để ước tính")
    up, down, top_s, top_l = pull(ctx.liq)
    if up + down <= 0:
        return CriterionResult("liquidation", 0.0, rule, f"Không có cụm thanh lý trong ±{t.liq_range_pct:g}%")
    p = ctx.liq["price"]
    side = lambda top, name: (  # noqa: E731
        f"{name} —" if top is None else f"{name} {fmt(top[0])} ({(top[0] / p - 1) * 100:+.1f}%, {money(top[1])})")
    s = (up - down) / (up + down)
    detail = f"{side(top_s, 'Short')} · {side(top_l, 'Long')} · Lực hút lên {up / (up + down):.0%}"
    a = abs(s)
    sc = 0.0 if a < t.liq_imbalance else (1.0 if a >= 2 * t.liq_imbalance else 0.5)
    return CriterionResult("liquidation", sc if s > 0 or sc == 0 else -sc, rule, detail)


CRITERIA = (crit_htf, crit_trend, crit_structure, crit_momentum, crit_volume, crit_derivatives, crit_btc,
            crit_liquidation)


def score(ctx: Context, weights: Weights) -> dict:
    t, w = ctx.t, weights.model_dump()
    results = []
    for fn in CRITERIA:
        r = fn(ctx)
        r.weight, r.name = w[r.id], CRITERIA_META[r.id]
        results.append(r)
    if ctx.is_btc:
        # BTC has no "BTC context": drop it and share its weight pro rata, so the shown weights
        # are the ones really used (a backtest found no better BTC-specific set, Nov 2026).
        results = [r for r in results if r.id != "btc"]
        rest = sum(r.weight for r in results)
        if rest:
            k = sum(w.values()) / rest
            for r in results:
                r.weight *= k

    active = [r for r in results if r.score is not None and r.weight > 0]
    total_w = sum(r.weight for r in active)
    raw = sum(r.weight * r.score for r in active)
    total = round(100 * raw / total_w, 1) if total_w else 0.0

    adx_now = ctx.adx[-1]
    ranging = _ok(adx_now) and adx_now < t.adx_trend_min
    verdict = make_verdict(total, t, ranging, adx_now)

    warnings = []
    r = ctx.rsi[-1]
    if _ok(r) and r >= t.rsi_overbought:
        warnings.append(f"RSI {r:.1f} trong vùng quá mua, dễ điều chỉnh dù xu hướng còn tăng.")
    if _ok(r) and r <= t.rsi_oversold:
        warnings.append(f"RSI {r:.1f} trong vùng quá bán, dễ hồi kỹ thuật dù xu hướng còn giảm.")
    if ctx.funding is not None and ctx.funding <= -t.funding_ok_max:
        warnings.append(f"Funding âm ({ctx.funding:.4f}%): phe short đông, có thể xảy ra short squeeze.")
    if ctx.liq is not None:
        _, _, top_s, top_l = pull(ctx.liq)
        tops = [(x, n) for x, n in ((top_s, "short"), (top_l, "long")) if x is not None]
        if tops:
            (lv, usd), name = max(tops, key=lambda z: z[0][1])
            dist = (lv / ctx.liq["price"] - 1) * 100
            if abs(dist) < 1:
                warnings.append(f"Cụm thanh lý {name} lớn nhất ({money(usd)}) chỉ cách {dist:+.1f}%: giá có thể "
                                f"quét nhanh tới {fmt(lv)} rồi đảo chiều, cẩn thận đặt stop gần đó.")
    by_id = {x.id: x for x in results}
    hs, ts = by_id["htf"].score, by_id["trend"].score
    if hs is not None and ts is not None and hs * ts < 0:
        warnings.append("Khung lớn đang ngược chiều khung hiện tại. Tín hiệu kém tin cậy hơn.")

    return {
        "score": total,
        "verdict": verdict,
        "criteria": [
            {
                "id": x.id, "name": x.name, "weight": round(x.weight, 1),
                "score": x.score, "status": x.status, "rule": x.rule, "detail": x.detail,
                "points": None if x.score is None or not total_w else round(100 * x.weight * x.score / total_w, 1),
            }
            for x in results
        ],
        "counts": {
            "bull": sum(1 for x in active if x.score > 0),
            "bear": sum(1 for x in active if x.score < 0),
            "neutral": sum(1 for x in active if x.score == 0),
            "na": len(results) - len(active),
        },
        "warnings": warnings,
    }


def make_verdict(total: float, t: Thresholds, ranging: bool, adx_now: float) -> dict:
    if ranging:
        return {"key": "ranging", "title": "Đi ngang, chưa có xu hướng",
                "note": f"ADX {adx_now:.1f} < {t.adx_trend_min:g}: lực xu hướng yếu, tín hiệu dễ nhiễu. Điểm chỉ mang tính tham khảo."}
    if total >= t.score_strong:
        return {"key": "strong_up", "title": "Xu hướng tăng mạnh",
                "note": "Phần lớn tiêu chí có trọng số cao đồng thuận tăng. Vẫn cần điểm cắt lỗ rõ ràng."}
    if total >= t.score_lean:
        return {"key": "lean_up", "title": "Nghiêng tăng",
                "note": "Bên mua chiếm ưu thế nhưng chưa đồng thuận hoàn toàn. Chờ thêm xác nhận."}
    if total <= -t.score_strong:
        return {"key": "strong_down", "title": "Xu hướng giảm mạnh",
                "note": "Phần lớn tiêu chí có trọng số cao đồng thuận giảm. Tránh mở long mới."}
    if total <= -t.score_lean:
        return {"key": "lean_down", "title": "Nghiêng giảm",
                "note": "Bên bán chiếm ưu thế nhưng chưa đồng thuận hoàn toàn. Thận trọng với lệnh long."}
    return {"key": "neutral", "title": "Trung tính",
            "note": "Tín hiệu tăng và giảm cân bằng. Chờ thị trường chọn hướng."}
