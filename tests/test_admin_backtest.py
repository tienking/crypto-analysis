"""Admin "run backtest now": systemctl is faked, nothing is started for real."""
import os

os.environ.setdefault("MONGODB_URL", "mongodb://localhost:1")
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api
from auth import create_token

URL = "/api/crypto-analysis/admin/backtest"


@pytest.fixture
def fake(monkeypatch):
    calls, state = [], {"is-active": (3, "inactive"), "start": (0, "")}

    async def systemctl(*args):
        calls.append(args)
        return state[args[0]]
    monkeypatch.setattr(api, "_systemctl", systemctl)
    app = FastAPI()
    app.include_router(api.router)
    c = TestClient(app)
    c.headers["Authorization"] = "Bearer " + create_token("admin")
    return c, calls, state


def test_needs_an_admin_token(fake):
    c, calls, _ = fake
    assert TestClient(c.app).post(URL + "/run").status_code in (401, 403)
    assert calls == []


def test_starts_the_systemd_unit_without_blocking(fake):
    c, calls, _ = fake
    r = c.post(URL + "/run")
    assert r.status_code == 200 and r.json() == {"state": "running"}
    assert calls[-1] == ("start", "--no-block", api.REWEIGHT_UNIT)


@pytest.mark.parametrize("out,state", [("activating", "running"), ("inactive", "idle"), ("failed", "failed")])
def test_state_maps_systemd(fake, out, state):
    c, _, st = fake
    st["is-active"] = (0 if out == "activating" else 3, out)
    assert c.get(URL).json() == {"state": state}


def test_refuses_a_second_run(fake):
    c, calls, st = fake
    st["is-active"] = (0, "activating")
    r = c.post(URL + "/run")
    assert r.status_code == 409 and not any(a[0] == "start" for a in calls)


def test_without_systemd_it_says_so(fake):
    c, _, st = fake
    st["is-active"] = (-1, "No such file or directory")
    assert c.get(URL).json() == {"state": "unavailable"}
    assert c.post(URL + "/run").status_code == 503


def test_a_failed_start_is_reported(fake):
    c, _, st = fake
    st["start"] = (1, "Access denied")
    r = c.post(URL + "/run")
    assert r.status_code == 503 and "Access denied" in r.json()["detail"]
