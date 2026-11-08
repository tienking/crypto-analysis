"""backtest.cache: incremental downloads through a fake collection."""
import numpy as np

from backtest import cache

STEP = 10


class Col:
    def __init__(self):
        self.docs = {}

    def find_one(self, q):
        return self.docs.get(q["_id"])

    def replace_one(self, q, doc, upsert=False):
        self.docs[q["_id"]] = doc


class Db(dict):
    def __missing__(self, k):
        self[k] = Col()
        return self[k]


class Source:
    """Closed candles every STEP from `listed`; records each fetch."""

    def __init__(self, listed=0):
        self.listed, self.calls = listed, []

    def __call__(self, a, b):
        self.calls.append((a, b))
        t = np.arange(max(a, self.listed) + (-max(a, self.listed)) % STEP, b - STEP + 1, STEP, dtype=np.int64)
        return {"t": t, "c": t.astype(float) * 2} if len(t) else None


def test_second_run_fetches_only_the_new_part_and_trims_the_old():
    db, src = Db(), Source()
    a = cache.series(db, "k", 100, 1000, src)
    assert src.calls == [(100, 1000)] and a["t"][0] == 100 and a["t"][-1] == 990
    b = cache.series(db, "k", 300, 1500, src)
    assert src.calls[-1] == (991, 1500)                    # only after the last stored candle
    assert b["t"][0] == 300 and b["t"][-1] == 1490 and np.all(np.diff(b["t"]) == STEP)
    assert np.array_equal(b["c"], b["t"] * 2.0)
    stored = cache.decode(db["cache"].docs["k"])
    assert np.array_equal(stored["t"], b["t"])


def test_a_later_listing_is_not_downloaded_again():
    db, src = Db(), Source(listed=500)
    cache.series(db, "k", 0, 1000, src)
    cache.series(db, "k", 50, 1100, src)
    assert src.calls[-1] == (991, 1100)


def test_asking_for_older_data_than_stored_downloads_in_full():
    db, src = Db(), Source()
    cache.series(db, "k", 500, 1000, src)
    out = cache.series(db, "k", 200, 1000, src)
    assert src.calls[-1] == (200, 1000) and out["t"][0] == 200


def test_without_db_or_with_a_broken_db_it_just_downloads():
    src = Source()
    assert cache.series(None, "k", 0, 100, src)["t"][-1] == 90

    class BrokenCol:
        def find_one(self, q): raise RuntimeError("down")
    assert cache.series({"cache": BrokenCol()}, "k", 0, 100, src)["t"][-1] == 90


def test_points_round_trip():
    s = cache.from_points([(1, 0.5), (2, 0.25)])
    assert cache.points(s) == [(1, 0.5), (2, 0.25)] and cache.from_points([]) is None
