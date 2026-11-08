"""Clear the backtest results, e.g. after changing the coin set.

    python -m backtest.reset --yes

Deletes `runs`, `weight_sets` and `bottom_rates`: the app falls back to the code defaults
until the next `python -m backtest.reweight`, which seeds them again and starts a new
history. Keeps `market_5m` (the OI archive cannot be downloaded again: Binance keeps ~30
days), `cache` (raw downloads, still valid) and `state` (the lock).
"""
from __future__ import annotations

import sys

from .store import sync_db

COLLECTIONS = ("runs", "weight_sets", "bottom_rates")


def reset(db) -> dict:
    return {c: db[c].delete_many({}).deleted_count for c in COLLECTIONS}


def main():
    if "--yes" not in sys.argv:
        print(f"Deletes every document in {', '.join(COLLECTIONS)}. Run again with --yes to do it.")
        return
    print(f"[reset] deleted {reset(sync_db())}", flush=True)


if __name__ == "__main__":
    main()
