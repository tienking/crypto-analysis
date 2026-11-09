"""Clear the backtest results, e.g. after changing the coin set.

    python -m backtest.reset --yes            # backtest results
    python -m backtest.reset --yes --scores   # also the score history chart

Deletes `runs`, `weight_sets` and `bottom_rates`: the app falls back to the code defaults
until the next `python -m backtest.reweight`, which seeds them again and starts a new
history. Keeps `market_5m` (the OI archive cannot be downloaded again: Binance keeps ~30
days), `cache` (raw downloads, still valid) and `state` (the lock). `--scores` also empties
`cryptonews.score_history`, whose old points no longer compare with new ones after a
criterion change (the web app keeps recording; the chart starts again from that minute).
"""
from __future__ import annotations

import sys

from .store import sync_db

COLLECTIONS = ("runs", "weight_sets", "bottom_rates")
SCORES = ("cryptonews", "score_history")   # the web app's database (database.py)


def reset(db) -> dict:
    return {c: db[c].delete_many({}).deleted_count for c in COLLECTIONS}


def clear_scores(client) -> int:
    return client[SCORES[0]][SCORES[1]].delete_many({}).deleted_count


def main():
    scores = "--scores" in sys.argv
    what = ", ".join(COLLECTIONS) + (f" and {'.'.join(SCORES)}" if scores else "")
    if "--yes" not in sys.argv:
        print(f"Deletes every document in {what}. Run again with --yes to do it.")
        return
    db = sync_db()
    out = reset(db)
    if scores:
        out["score_history"] = clear_scores(db.client)
    print(f"[reset] deleted {out}", flush=True)


if __name__ == "__main__":
    main()
