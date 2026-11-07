"""Weekly job: backtest the criteria and update the default weights (with guardrails).

    python -m backtest.reweight            # BACKTEST_WORKERS=2 by default

Two weight groups, because the backtest behaves very differently by timeframe:
short = 5m/15m/30m/1h, long = 4h/12h/1d. Derivatives and liquidation keep their weight
until the archive (backtest.collect) holds MIN_OI_DAYS of OI history; then they are fitted
like the others. Every run is stored in `runs`, every applied change in `weight_sets`.
The same run re-measures the bottom-signal hit rates (backtest.bottoms -> `bottom_rates`).
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from analysis.config import HIGHER_TF, Weights

from . import engine
from .bottoms import update as update_bottoms
from .binance_hist import COINS, Http, funding, klines
from .fit import propose
from .store import DAY_MS, GROUPS, series_from_docs, sync_db

PRICE_IDS = ["htf", "trend", "structure", "momentum", "volume", "btc"]
DERIV_IDS = ["derivatives", "liquidation"]
TFS = [tf for g in GROUPS.values() for tf in g]
N_CANDLES = 15000
MIN_OI_DAYS = 180
TF_MS = {"5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
         "4h": 14_400_000, "12h": 43_200_000, "1d": DAY_MS}


def now():
    return datetime.now(timezone.utc)


def ensure_baseline(db) -> dict:
    """Active weights per group; seeds the code defaults on the first run."""
    out = {}
    for g in GROUPS:
        doc = db.weight_sets.find_one({"group": g, "active": True})
        if not doc:
            doc = {"group": g, "weights": Weights().model_dump(), "created_at": now(), "source": "default", "active": True}
            db.weight_sets.insert_one(doc)
        out[g] = doc["weights"]
    return out


def oi_days(db) -> int:
    """Days of OI history archived, for the coin with the least."""
    counts = [db.market_5m.count_documents({"symbol": c + "USDT", "oi": {"$exists": True}}) for c in COINS]
    return min(counts) if counts else 0


def load_price(http) -> dict:
    spot = {}
    tfs = sorted(set(TFS) | {HIGHER_TF[t] for t in TFS}, key=lambda t: TF_MS.get(t, 10**12))
    for c in COINS:
        spot[c] = {tf: klines(http, c + "USDT", tf, N_CANDLES) for tf in tfs}
    return spot


def load_deriv(db, http, days: int) -> dict:
    out = {}
    since = int(time.time() * 1000) - (days + 2) * DAY_MS
    for c in COINS:
        sym = c + "USDT"
        docs = list(db.market_5m.find({"symbol": sym, "oi": {"$exists": True}}, {"start": 1, "oi": 1, "oi_usd": 1}))
        oi = {}
        for tf, step in TF_MS.items():
            a = series_from_docs(docs, "oi", step)
            b = dict(series_from_docs(docs, "oi_usd", step))
            oi[tf] = [(ts, v, b[ts]) for ts, v in a if ts in b]
        fut = {tf: klines(http, sym, tf, days * DAY_MS // step + engine.W + 20, futures=True) for tf, step in TF_MS.items()}
        out[c] = {"oi": oi, "fut": fut, "funding": funding(http, sym, since - 30 * DAY_MS)}
    return out


def main():
    db = sync_db()
    started = now()
    run = {"started_at": started, "status": "running"}
    run_id = db.runs.insert_one(run).inserted_id
    try:
        state = db.state.find_one({"_id": "weights"}) or {}
        locked = bool(state.get("locked"))
        current = ensure_baseline(db)
        days = oi_days(db)
        use_deriv = days >= MIN_OI_DAYS
        span = min(days, 365)                    # bounds the derivative replay time
        workers = int(os.getenv("BACKTEST_WORKERS", "2"))
        http = Http()
        t0 = time.time()
        data = {"spot": load_price(http), "deriv": load_deriv(db, http, span) if use_deriv else {}}
        t_dl = time.time() - t0
        jobs = [("price", c, tf) for c in COINS for tf in TFS]
        rows = engine.run(data, jobs, workers)
        if use_deriv:
            d_rows = engine.run(data, [("deriv", c, tf) for c in COINS for tf in TFS], workers)
            by_key = {(r["coin"], r["tf"], r["t"]): r for r in d_rows}
            for r in rows:
                d = by_key.get((r["coin"], r["tf"], r["t"]))
                r["derivatives"] = d["derivatives"] if d else None
                r["liquidation"] = d["liquidation"] if d else None
        else:
            for r in rows:
                r["derivatives"] = r["liquidation"] = None
        fit_ids = PRICE_IDS + (DERIV_IDS if use_deriv else [])
        groups = {}
        for g, tfs in GROUPS.items():
            res = propose(rows, current[g], fit_ids, tfs, locked=locked)
            groups[g] = res
            if res["applied"]:
                db.weight_sets.update_many({"group": g, "active": True}, {"$set": {"active": False}})
                db.weight_sets.insert_one({"group": g, "weights": res["weights"], "created_at": now(),
                                           "source": "backtest", "active": True, "run_id": run_id})
        try:
            bottoms = update_bottoms(db, http, locked)
        except Exception as e:  # noqa: BLE001 — a failure here must not lose the weights run
            bottoms = {"applied": False, "reason": f"error: {str(e)[:300]}"}
        db.runs.update_one({"_id": run_id}, {"$set": {
            "status": "done", "finished_at": now(), "locked": locked, "oi_days": days, "deriv_included": use_deriv,
            "rows": len(rows), "download_s": round(t_dl), "groups": groups, "bottoms": bottoms}})
        print(f"[reweight] {len(rows)} rows, oi_days={days}, "
              + ", ".join(f"{g}: {'applied' if r['applied'] else 'kept'} ({r['reason']})" for g, r in groups.items())
              + f", bottom rates: {'applied' if bottoms['applied'] else 'kept'} ({bottoms['reason']})",
              flush=True)
    except Exception as e:
        db.runs.update_one({"_id": run_id}, {"$set": {"status": "error", "finished_at": now(), "error": str(e)[:500]}})
        raise


if __name__ == "__main__":
    main()
