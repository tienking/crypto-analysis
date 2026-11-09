"""Weekly job: backtest the criteria and update the default weights (with guardrails).

    python -m backtest.reweight            # BACKTEST_WORKERS=2 by default

Two weight groups, because the backtest behaves very differently by timeframe:
short = 5m/15m/30m/1h, long = 4h/12h/1d. Derivatives and liquidation are replayed on Bybit's
history (bybit_hist: OI, futures candles and funding since 2020) and fitted like the
others. If Bybit fails, the run falls back to the Binance archive (backtest.collect), used
once it holds MIN_OI_DAYS of OI; below that they keep their weight. Every run is stored in `runs`, every applied change in `weight_sets`.
The same run re-measures the bottom-signal hit rates (backtest.bottoms -> `bottom_rates`).

Progress goes to stdout (journalctl) with the elapsed time. A run stopped by SIGTERM (systemd's
TimeoutStartSec, a restart) is marked "error" in `runs`; a run killed harder (SIGKILL, power
loss) stays "running" until the next run starts and closes it.
"""
from __future__ import annotations

import os
import signal
import time
from datetime import datetime, timezone

from analysis.config import HIGHER_TF, LIQ_PERIOD, Weights

from . import bybit_hist, engine
from .bottoms import update as update_bottoms
from .binance_hist import COINS, Http, cached_klines, funding, klines
from .fit import propose
from .store import DAY_MS, GROUPS, series_from_docs, sync_db

PRICE_IDS = ["htf", "trend", "structure", "momentum", "volume", "btc"]
DERIV_IDS = ["derivatives", "liquidation"]
TFS = [tf for g in GROUPS.values() for tf in g]
N_CANDLES = 15000
MIN_OI_DAYS = 180
TF_MS = {"5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
         "4h": 14_400_000, "12h": 43_200_000, "1d": DAY_MS}


_T0 = time.time()


def now():
    return datetime.now(timezone.utc)


def log(msg: str):
    """One progress line with the elapsed time, e.g. "[reweight +1h05m] ..."."""
    m = int(time.time() - _T0) // 60
    print(f"[reweight +{m // 60}h{m % 60:02d}m] {msg}", flush=True)


def every_tenth(label: str):
    """engine.run progress callback: one line per 10% of the jobs."""
    def cb(done, total):
        if done == total or done * 10 // total != (done - 1) * 10 // total:
            log(f"{label} {done}/{total}")
    return cb


class Stopped(BaseException):
    """BaseException: the `except Exception` fallbacks (Bybit, bottoms) must not swallow it."""


def on_sigterm(main_pid: int):
    """SIGTERM -> Stopped in the main process (so the run is recorded as an error); pool
    workers forked from it, which get the same signal, just exit."""
    def handler(signum, frame):
        if os.getpid() != main_pid:
            os._exit(1)
        raise Stopped("stopped by SIGTERM (systemd timeout or restart)")
    return handler


def close_stale(db) -> int:
    """Runs left "running" by a process that died: one run at a time, so any is stale."""
    return db.runs.update_many({"status": "running"}, {"$set": {
        "status": "error", "finished_at": now(), "error": "interrupted (process stopped before it finished)"}}).modified_count


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


def load_price(http, db=None) -> dict:
    spot = {}
    now = int(time.time() * 1000)
    tfs = sorted(set(TFS) | {HIGHER_TF[t] for t in TFS}, key=lambda t: TF_MS.get(t, 10**12))
    for i, c in enumerate(COINS, 1):
        spot[c] = {tf: cached_klines(db, http, c + "USDT", tf, N_CANDLES, now) for tf in tfs}
        log(f"price candles {i}/{len(COINS)} ({c})")
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


def load_deriv_bybit(db=None) -> dict:
    """engine input for every coin Bybit lists; raises if Bybit cannot be reached at all."""
    now = int(time.time() * 1000)
    http = Http(bybit_hist.PAUSE)
    out = {}
    for i, c in enumerate(COINS, 1):
        d = bybit_hist.load_coin(http, c, TFS, LIQ_PERIOD, now, N_CANDLES, engine.W, db)
        if d is not None:
            out[c] = d
        log(f"Bybit derivatives {i}/{len(COINS)} ({c}{'' if d is not None else ': not listed'})")
    if not out:
        raise RuntimeError("Bybit returned no data")
    return out


def main():
    signal.signal(signal.SIGTERM, on_sigterm(os.getpid()))
    db = sync_db()
    stale = close_stale(db)
    if stale:
        log(f"closed {stale} run(s) left 'running' by a stopped process")
    started = now()
    run = {"started_at": started, "status": "running"}
    run_id = db.runs.insert_one(run).inserted_id
    try:
        state = db.state.find_one({"_id": "weights"}) or {}
        locked = bool(state.get("locked"))
        current = ensure_baseline(db)
        days = oi_days(db)
        workers = int(os.getenv("BACKTEST_WORKERS", "2"))
        log(f"start: {len(COINS)} coins, {len(TFS)} timeframes, {workers} worker(s), oi_days={days}")
        http = Http()
        t0 = time.time()
        spot = load_price(http, db)
        try:
            deriv, deriv_source = load_deriv_bybit(db), "bybit"
        except Exception as e:  # noqa: BLE001 — e.g. Bybit blocks the IP: use the Binance archive
            log(f"Bybit history failed ({str(e)[:200]}), using the Binance archive")
            deriv_source = "binance" if days >= MIN_OI_DAYS else None
            deriv = load_deriv(db, http, min(days, 365)) if deriv_source else {}
        use_deriv = bool(deriv)
        data = {"spot": spot, "deriv": deriv}
        t_dl = time.time() - t0
        jobs = [("price", c, tf) for c in COINS for tf in TFS]
        log(f"downloads done ({round(t_dl / 60)} min), deriv={deriv_source}")
        rows = engine.run(data, jobs, workers, every_tenth("price criteria"))
        if use_deriv:
            d_rows = engine.run(data, [("deriv", c, tf) for c in COINS for tf in TFS], workers,
                                every_tenth("derivative criteria"))
            by_key = {(r["coin"], r["tf"], r["t"]): r for r in d_rows}
            for r in rows:
                d = by_key.get((r["coin"], r["tf"], r["t"]))
                r["derivatives"] = d["derivatives"] if d else None
                r["liquidation"] = d["liquidation"] if d else None
        else:
            for r in rows:
                r["derivatives"] = r["liquidation"] = None
        fit_ids = PRICE_IDS + (DERIV_IDS if use_deriv else [])
        log("fitting weights")
        groups = {}
        for g, tfs in GROUPS.items():
            res = propose(rows, current[g], fit_ids, tfs, locked=locked)
            groups[g] = res
            if res["applied"]:
                db.weight_sets.update_many({"group": g, "active": True}, {"$set": {"active": False}})
                db.weight_sets.insert_one({"group": g, "weights": res["weights"], "created_at": now(),
                                           "source": "backtest", "active": True, "run_id": run_id})
        log("bottom-signal hit rates")
        try:
            bottoms = update_bottoms(db, http, locked)
        except Exception as e:  # noqa: BLE001 — a failure here must not lose the weights run
            bottoms = {"applied": False, "reason": f"error: {str(e)[:300]}"}
        db.runs.update_one({"_id": run_id}, {"$set": {
            "status": "done", "finished_at": now(), "locked": locked, "oi_days": days, "deriv_included": use_deriv,
            "deriv_source": deriv_source,
            "rows": len(rows), "download_s": round(t_dl), "groups": groups, "bottoms": bottoms}})
        log(f"done: {len(rows)} rows, oi_days={days}, deriv={deriv_source}, "
            + ", ".join(f"{g}: {'applied' if r['applied'] else 'kept'} ({r['reason']})" for g, r in groups.items())
            + f", bottom rates: {'applied' if bottoms['applied'] else 'kept'} ({bottoms['reason']})")
    except BaseException as e:   # also Stopped (SIGTERM) and Ctrl+C
        db.runs.update_one({"_id": run_id}, {"$set": {"status": "error", "finished_at": now(), "error": str(e)[:500]}})
        log(f"failed: {str(e)[:300] or type(e).__name__}")
        raise


if __name__ == "__main__":
    main()
