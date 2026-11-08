# Crypto Analysis

A coin trend scorer. A TradingView market chart sits on top; below it, any coin is scored
from **−100 to +100** with **8 weighted technical criteria** on live Binance data, with a
verdict, the indicators behind it, and an AI assistant that explains the analysis on screen.
The analysis UI and the Admin page are in Vietnamese.

🔗 **Live:** [tienmai.space/projects/crypto-analysis](https://tienmai.space/projects/crypto-analysis)
(formerly **crypto-news**, an RSS news site; the old `/projects/crypto-news/` links redirect here)

---

## How it works

1. **Market chart** — a TradingView candle chart (1H) for the coin pairs set in Admin.
   The same pairs appear as quick-pick chips under the analysis coin input.
   The header's **Hướng dẫn** button opens a full-screen beginner guide (Vietnamese): the
   indicators (EMA, MA, RSI, MACD, ADX, volume, pivots, open interest, funding: description,
   formula as computed in `analysis/indicators.py`, how to read it), each of the 8 criteria
   (description, exact rules, and an **illustrated example** with a chart, how to read it and
   a worked calculation), how the score and verdict are computed, the warnings, where the
   weights come from, the bottom signals and the limits. Its
   thresholds and the current weights are read from `/analysis/config`, so the text always
   matches what the server computes. The example prices are made up, but every indicator and
   signal in them is computed with the server's rules (`guideData.js` ports EMA, RSI, MACD and
   the criteria), so a chart never claims a signal the app would not give. Esc or ✕ closes it.
   Picking a pair on the chart analyses that coin below.
2. **Analysis** — the backend pulls Binance public market data (no API key): candles for the
   timeframe and the next higher one, BTC candles, funding rate and open-interest change.
   It computes EMA, RSI (Wilder), MACD, ADX and price pivots with numpy, builds an estimated
   liquidation map from open-interest history, then scores 8
   criteria, each giving a signal in `[-1, 1]` (or no data):

   | Criterion | Weight | Bullish when |
   |---|---|---|
   | Higher-timeframe agreement | 5 | EMA trend up on the higher timeframe (5m→30m, 15m→1h, 30m→2h, 1h→4h, 4h→1d, 12h→3d, 1d→1w) |
   | EMA trend | 17 | Price > EMA50 > EMA200 |
   | Price structure | 13 | Higher high + higher low, or a break of the last pivot high |
   | Momentum | 17 | RSI ≥ 50 and rising; MACD histogram positive and widening |
   | Volume confirmation | 15 | Green-candle volume ≥ 1.2× red over 20 candles |
   | Derivatives | 5 | OI up ≥ 3% with price up and funding ≤ 0.03% (funding ≥ 0.05% is bearish) |
   | BTC context | 23 | BTC's EMA trend up on the same timeframe (dropped when analysing BTC: its weight is shared pro rata by the other 7, and the table shows those effective weights; a BTC-only fitted set did not beat this on the test half) |
   | Liquidation zones (estimated) | 5 | Shorts waiting above pull harder than longs waiting below (within ±5%) |

   **Weights come from a backtest**. Since v2.16.0 it runs on 13 coins (BTC, ETH, BNB, XRP, SOL, TRX, DOGE, ADA, LTC, AVAX, SUI, TAO, DOT;
   not BGB, which is not on Binance, nor HYPE, whose Binance spot history starts Sep 2026 and
   which trades mostly on Hyperliquid). The code defaults and the tables below are from the first backtest (Nov 2026,
   10 coins: BTC, ETH, SOL, XRP, LTC, BNB, DOGE, ADA, LINK, AVAX; up to 15,000 candles per timeframe; the app's own criteria code replayed candle by
   candle, with the forming higher-timeframe candle rebuilt so nothing looks ahead). Target:
   the return over the next 5 candles, scaled by recent volatility. Information coefficient
   (correlation of signal and that return):

   | Criterion | 5m–30m | 1h | 4h / 12h / 1d |
   |---|---|---|---|
   | Higher timeframe | ≈ 0 | +0.01 | +0.02 / +0.00 / −0.01 |
   | EMA trend | ≈ 0 | ≈ 0 | +0.04 / +0.05 / +0.04 |
   | Structure | ≈ 0 to −0.02 | +0.02 | +0.02 / +0.04 / +0.05 |
   | Momentum | −0.02 | +0.01 | +0.03 / +0.06 / +0.05 |
   | Volume | ≈ 0 | +0.02 | +0.02 / +0.05 / +0.06 |
   | BTC context | ≈ 0 | +0.01 | +0.05 / +0.06 / +0.08 |

   The six price criteria share 90 points in proportion to their 4h–1d IC, fitted on the older
   half of each history; on the newer half that beat the old hand-picked weights on every
   timeframe from 4h (composite IC 4h +0.027 → +0.032, 12h +0.019 → +0.033, 1d +0.023 → +0.039).
   Derivatives and liquidation have only ~30 days of OI history (IC ≈ 0, too few samples to
   tell), so they keep 5 each. **On 5m–30m no criterion and no weighting predicted the next
   candles**: treat the score there as a description of the current trend, not a forecast
   (the page shows that warning on 5m/15m/30m).

   **Weights now update themselves weekly** (see *Backtest pipeline* below), separately for
   two groups: **short** = 5m/15m/30m/1h and **long** = 4h/12h/1d. The table above is the
   starting point of both.

   **Score = 100 × Σ(weight × signal) / Σ weight** of the criteria that have data. ADX14 below
   20 makes the verdict **ranging** whatever the score; otherwise ≥ 50 strong up, ≥ 20 lean up,
   mirrored for down. Warnings (no points): RSI overbought/oversold, negative funding (short
   squeeze risk), higher timeframe against the current one, the biggest liquidation cluster
   within 1% (likely sweep then reversal).

   **Liquidation map** (`analysis/liquidation.py`): Binance publishes none, so it is a model, like
   the public heatmaps. Open-interest history (500 points of `openInterestHist`, Binance keeps 30 days:
   5m for 5m, 15m for 15m, 30m for 30m, 1h for 1h/4h, 2h for 12h, 4h for 1d) is aligned with futures candles. Each OI rise = new
   positions at the candle's typical price, one long and one short per contract, spread over
   10x/25x/50x/100x (5/20/40/35%, calibrated on BTC against Coinglass); a long liquidates near `entry × (1 − 1/L + 0.4%)`, a short
   near `entry × (1 + 1/L − 0.4%)`. A level is removed once a later candle trades through it; an
   OI fall shrinks every open level pro rata. What remains is binned in 0.25% steps within
   ±`liq_range_pct`. Pull of a side = Σ USD / distance% (floor 0.2%); the signal is
   `(up − down) / (up + down)`: ±1 from 2 × `liq_imbalance`, ±0.5 from `liq_imbalance`. The page
   draws the map (shorts above in green, longs below in red) with the biggest cluster per side.
   **Bottom signals** (`analysis/bottoms.py`, the "Dấu hiệu đáy" card), on fixed timeframes
   whatever the one on screen: **short** = 4h candles (is price at a 7-day low, i.e. is the
   lowest low of the last day also the lowest of 7 days?), **mid** = 1d candles (last 7 days vs
   60 days). Four bottom signs at the last closed candle: RSI ≤ 30 in the last 3 candles,
   bullish RSI divergence, MACD line below 0 with the histogram rising 2 candles, a
   capitulation candle (red, volume ≥ 2× the 20-candle average) in the last 5. At a low, the
   card shows the **measured share of past lows with the same number of signs (0/1/2/3+) that
   held** for the next 7 / 60 days, against the share of all lows; away from a low it shows
   the distance to it and no rate. Measured on the full spot history of the backtest
   coins, re-measured every week (see Backtest pipeline); the table at the first measurement:

   | Signs | Short (4h, 7 days) | Mid (1d, 60 days) |
   |---|---|---|
   | 0 | 19% (4,227 lows) | 25% (639) |
   | 1 | 29% (12,217) | 31% (1,520) |
   | 2 | 31% (10,683) | 36% (1,256) |
   | 3–4 | 38% (2,512) | 50% (290) |
   | all lows | 29% | 33% |

   On both the older and the newer half of the history, 0 signs is the lowest rate and 3+ the
   highest (1 and 2 signs swap places on the older 4h half). **Cycle** = a
   checklist on weekly candles, not a rate (Binance history holds two cycle bottoms): ≥ 70%
   under the all-time high, weekly RSI ≤ 30 in the last 8 weeks, price under the 200-week MA
   (needs 200 weeks), a capitulation week in the last 8, weekly MACD below 0 with the
   histogram rising. BTC met 4/5 around the Dec 2018 bottom and through Jun–Dec 2022; for
   altcoins the drawdown condition stays true for years, so it fires early. All of it is
   optional data: a failure leaves that part `null`.
3. **Settings** — visitors can change every threshold and weight; they are kept in their
   browser (`localStorage`: `ca-thresholds`, `ca-weights-v2`, `ca-last`) and sent with each
   request. Without custom weights the request sends none and the server uses the active
   backtest set of the timeframe's group (the criteria table says which, and since when).
   The old `ca-weights` key is ignored and removed: it was also written when only a threshold
   changed, which would have pinned those visitors to the old weights. The analysis refreshes
   every 60 s (can be turned off).
4. **AI assistant** (bottom-right) — DeepSeek or Gemini (Google), switchable in Admin. Each
   message sends the coin, timeframe, thresholds and weights on screen; the **server reruns the
   analysis** (15 s cache) and gives the result to the model as context, so the browser cannot
   feed it made-up numbers.
5. **Admin** (`/projects/crypto-analysis/admin`, JWT login) — chart coin pairs, AI provider/model,
   password (MongoDB `settings` collection), and **Backtest weights**: the active set per
   group, a **chart of every run** (test IC of the weights in effect after the run, per group;
   filled dot = new weights applied, hollow = kept; hover or arrow keys for the values),
   recent runs (test IC now → proposed, applied or why not), **Lock** (runs still
   propose but apply nothing), **Roll back** (re-activate the previous set of a group) and
   **Chạy backtest ngay** (start the weekly run now: `systemctl start --no-block` on the same
   unit as the timer, so it runs at low priority, survives closing the browser and never runs
   twice; the page checks the unit every 20 s and reloads the results when it ends);
   plus the **bottom-signal rates** in use and the last measurement (applied or why kept).

### Backtest pipeline

Two systemd timers on the VPS run the `backtest/` package (`deploy/crypto-analysis-*.timer`):

| Job | When | What |
|---|---|---|
| `python -m backtest.collect` | daily 00:00 Vietnam time (17:00 UTC) | Archives Binance's 5m futures series that Binance keeps only ~30 days: open interest (contracts + USD), global long/short account ratio, top-trader position ratio, taker buy/sell volume, for the backtest coins (BTC, ETH, BNB, XRP, SOL, TRX, DOGE, ADA, LTC, AVAX, SUI, TAO, DOT). Fetches only what is newer than the archive, so after downtime of up to ~29 days the next run fills the gap. |
| `python -m backtest.reweight` | Sunday 07:15 Vietnam time (00:15 UTC, after the daily candle closes) | Downloads up to 15,000 candles per timeframe, replays the app's own criteria code (`backtest/engine.py`), and proposes new weights per group (`backtest/fit.py`). Derivative rows come from Bybit's history. Every download goes through a cache in the database (`backtest/cache.py`), so only the first run fetches the full history (about an hour with Bybit); later runs fetch only the new week. Then re-measures the bottom-signal hit rates (`backtest/bottoms.py`, ~3 min of extra downloads). Runs at low CPU/IO priority with 2 workers (`BACKTEST_WORKERS`), up to 6 h (`TimeoutStartSec`; a run with derivatives takes about 2–3 h). |

Guardrails of a weekly update (`backtest/fit.py`):
1. Each (coin, timeframe) history is split in time: older half = train, newer half = test.
2. Candidate = the criteria's points shared in proportion to their train IC (negative → 0).
   Criteria without enough rows in the group keep their weight.
3. Step towards the candidate by the largest fraction that moves no weight more than
   **3 points**, keeping the total.
4. **Apply only if** the stepped set's composite IC on the test half beats the current set's
   by at least 0.002, and weights are not locked. Otherwise the run is recorded and nothing
   changes.
5. Derivatives and liquidation are replayed on **Bybit's** USDT-perpetual history
   (`backtest/bybit_hist.py`: OI, futures candles and funding over the same span as each
   timeframe's spot candles, from 2020), because Binance keeps 5m OI for only ~30 days. A coin
   Bybit does not list gets no derivative rows. If Bybit cannot be reached at all, the run
   falls back to the Binance archive once it holds **180 days** of OI (on ~15 days a trial
   gave liquidation an IC of +0.07, exactly the noise this threshold keeps out); below that
   the two keep their weight. The run records `deriv_source` (`bybit`, `binance` or null).
   A study on BTC and ETH (Nov 2026) found no stable edge yet: both had a negative IC on the
   older half and a positive one on the newer half.
6. Bottom-signal rates: a new table is applied only if every sign-count group has ≥ 200
   lows, 0 signs has the lowest rate and 3+ the highest, and weights are not locked; otherwise
   the measurement is stored and the active table kept. `python -m backtest.bottoms` runs this
   step alone (`--dry-run` only prints).

`python -m backtest.prefetch` only fills the download cache (no backtest), e.g. before the
first run on a new coin set; a later run then fetches only what is new.

`python -m backtest.reset --yes` deletes `runs`, `weight_sets` and `bottom_rates` (used when the
coin set changes); the app then uses the code defaults until the next reweight run. The OI
archive `market_5m`, the download `cache` and the lock are kept.

Storage: MongoDB database `ca_backtest` (env `BACKTEST_DB`) on the same cluster:
`market_5m` (one document per coin per UTC day, 288 slots per field, about 105 MB per year
for 13 coins), `weight_sets` (every set used, one `active` per group), `runs` (every weekly
run with its metrics), `state` (`{_id: "weights", locked}`), `bottom_rates` (every
bottom-rate measurement, one `active`) and `cache` (the downloaded candles, OI and funding the
weekly run reuses: one zlib-compressed document per series, about 110 MB for 13 coins; it
does not grow, since each series keeps a fixed window. Safe to delete: the next run downloads
everything again). The web app reads the active weight sets and bottom
table once a minute and falls back to the code defaults when the database is unreachable.

Binance data: spot candles from `data-api.binance.vision`, then `api.binance.com`, then
USDⓈ-M futures; funding, open interest (change + history) and futures candles for the
liquidation map from `fapi.binance.com`, plus 4h, 1d and 1w candles for the bottom signals
(up to 10 requests per analysis, 15 s cache). Missing
optional data (higher timeframe, BTC, funding, OI) only marks that criterion "no data". ⚠️ Binance blocks
US IPs (HTTP 451): the server must run outside the US.

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Backend | Python / FastAPI · Uvicorn (port **8003**) |
| Analysis | numpy (no pandas / TA library) · httpx async Binance client with host fallback and a 15 s TTL cache |
| Chatbot | DeepSeek (`deepseek-flash` / `deepseek-v4-pro`) or Gemini (Google), grounded in the analysis on screen |
| Database | MongoDB (Motor) — db `cryptonews` (old name kept, so no data move), collection `settings`; db `ca_backtest` for the backtest archive and weights (pymongo in the jobs) |
| Frontend | React 19 + Vite (base `/projects/crypto-analysis/`) · Inter + JetBrains Mono · TradingView widget |
| Hosting | Hostinger VPS (shared), Nginx, systemd, GitLab CI/CD |

---

## Project Structure

```
crypto-analysis/
├── main.py                  # FastAPI app; shared httpx client → BinanceClient
├── api.py                   # Routes (/api/crypto-analysis/*), analysis rate limit, chat context
├── analysis/                # Coin scoring (ported from the standalone coin-analysis app)
│   ├── binance.py           # Binance client: host fallback, TTL cache, SymbolNotFound / UpstreamError
│   ├── config.py            # Thresholds, Weights (pydantic, bounded), Vietnamese labels, HIGHER_TF
│   ├── indicators.py        # Pure numpy: ema, rsi, macd, adx, pivots
│   ├── criteria.py          # Candles, Context, the 8 crit_* functions, score(), verdict
│   ├── liquidation.py       # Pure numpy liquidation-map model + pull()
│   ├── bottoms.py           # Bottom signs, measured hit rates (short 4h / mid 1d), weekly cycle checklist
│   └── service.py           # analyze(): parallel fetch → Context → score → JSON (no NaN)
├── ai.py                    # Chat dispatcher → DeepSeek or Gemini per AI settings
├── deepseek.py / gemini.py  # Chat clients
├── auth.py                  # Admin JWT + bcrypt
├── database.py              # Motor: settings (coins / AI / admin), seed defaults; active weights (60 s cache), lock, rollback
├── config.py                # Env loader (Mongo, AI keys, JWT_SECRET, ADMIN_*)
├── backtest/                # Run by systemd timers, not by the web app
│   ├── store.py             # ca_backtest layout, day buckets, weight groups, rollback target
│   ├── binance_hist.py      # Sync, throttled, paginated Binance history downloads
│   ├── bybit_hist.py        # Bybit OI / futures candles / funding history for the derivative replay
│   ├── cache.py             # Download cache in ca_backtest.cache: a run fetches only what is new
│   ├── prefetch.py          # Manual: fill / top up the cache without running the backtest
│   ├── collect.py           # Daily: archive 5m OI / long-short / taker series
│   ├── engine.py            # Replays the criteria candle by candle (no look-ahead)
│   ├── fit.py               # IC weights + guardrails (split, ±3 step, must beat current)
│   ├── bottoms.py           # Weekly (from reweight) or manual: measure bottom-signal hit rates → bottom_rates
│   ├── reweight.py          # Weekly: backtest → propose → apply or keep → record the run
│   └── reset.py             # Manual: clear runs, weight_sets, bottom_rates (after a coin-set change)
├── tests/                   # pytest, fake Binance + fake AI (no network, no MongoDB)
├── requirements.txt / requirements-dev.txt
├── .env.example
├── deploy/
│   ├── crypto-analysis.service  # systemd unit (port 8003)
│   ├── crypto-analysis-collect.service / .timer   # daily archive job
│   ├── crypto-analysis-reweight.service / .timer  # weekly backtest + weights
│   └── nginx-snippet.conf
└── frontend/
    ├── index.html
    ├── vite.config.js       # base "/projects/crypto-analysis/", proxy → 8003
    └── src/
        ├── main.jsx            # Routes to AdminApp if path ends with /admin, else App
        ├── App.jsx             # Header (Hướng dẫn + Admin), chart, analysis, chat, guide
        ├── AdminApp.jsx        # Login + AI settings + backtest weights + coin pairs + password
        ├── index.css           # Dark theme, fonts, up/down/warn colours
        ├── components/
        │   ├── MarketChart.jsx  # TradingView chart; picking a pair analyses it
        │   ├── Analysis.jsx     # Controls, verdict + gauge, candle chart, indicators, liquidation map, criteria, settings
        │   ├── RunsChart.jsx    # Admin: test IC per backtest run (SVG line chart, tooltip, hidden table)
        │   ├── Guide.jsx        # "Hướng dẫn" full-screen guide to the criteria (numbers from /analysis/config)
        │   ├── GuideFigures.jsx # One illustrated example per criterion (SVG at measured width)
        │   ├── guideData.js     # Example series + JS ports of EMA/RSI/MACD and the criteria rules
        │   └── ChatPopup.jsx    # AI assistant (bottom-right)
        └── lib/api.js           # API client
```

---

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/crypto-analysis/health` | Health check |
| GET | `/api/crypto-analysis/analysis/config` | Default thresholds and weights, active `weight_sets` per group, `weight_groups`, Vietnamese labels, `bottoms` (horizons, active measured rates, samples, base rates, `updated_at`, `source`) |
| POST | `/api/crypto-analysis/analysis` | `{symbol, timeframe, thresholds?, weights?}` (no `weights` = the active backtest set of the timeframe's group; `weights_info` says which) → score, verdict, criteria, indicators, 120 candles + EMAs, `liquidation` (bins, biggest cluster per side, pull share; null without futures), `bottoms` (`short`, `mid`: at a low?, signs, measured rate; `cycle`: weekly checklist). 404 unknown pair, 502 Binance down, 422 bad input or too few candles, 429 over 30 requests/min per IP |
| GET | `/api/crypto-analysis/coins` | Chart coin pairs (public) |
| POST | `/api/crypto-analysis/chat` | `{message, history, analysis?}` → `{reply, provider}`; `analysis` is rerun on the server as context |
| POST | `/api/crypto-analysis/admin/login` | Admin login → JWT (5 failed attempts per IP → 429, locked 5 min) |
| GET/PUT | `/api/crypto-analysis/admin/coins` | Read / save chart coin pairs |
| GET/PUT | `/api/crypto-analysis/admin/ai-settings` | Read / save provider + per-provider model |
| GET | `/api/crypto-analysis/admin/weights` | Active + past weight sets per group, last 10 runs, `history` (chart points of the last 104 completed runs), lock state, days of OI archived, `bottoms` (active rate table + last measurement) |
| PUT | `/api/crypto-analysis/admin/weights/lock` | `{locked}` |
| POST | `/api/crypto-analysis/admin/weights/rollback` | `{group: short | long}` → re-activate the previous set (400 if none) |
| GET | `/api/crypto-analysis/admin/backtest` | `{state}`: `running`, `idle`, `failed` (last run failed) or `unavailable` (no systemd) |
| POST | `/api/crypto-analysis/admin/backtest/run` | Start `crypto-analysis-reweight.service` now (409 if running, 503 without systemd or if the start fails) |

`timeframe` ∈ `5m | 15m | 30m | 1h | 4h | 12h | 1d`; the symbol is normalised to `{BASE}USDT`.

> **Admin:** seeded on first run from `ADMIN_USERNAME` (default `admin`) /
> `ADMIN_PASSWORD` env. If `ADMIN_PASSWORD` is unset, a random one is generated and
> printed once at startup — there is no guessable default.
>
> **Required env:** `MONGODB_URL` and `JWT_SECRET` are mandatory — the app refuses to
> start without them (no fallback secret).
>
> **Old news data:** the `articles` collection from the RSS version is no longer used; its
> TTL index empties it within 30 days of the last fetch.

---

## Local Development

```bash
# Backend
python -m venv crypto-analysis-venv
source crypto-analysis-venv/bin/activate     # Windows: crypto-analysis-venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                       # set MONGODB_URL, JWT_SECRET, AI keys
uvicorn main:app --port 8003
pytest -q                                  # no network needed

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                                # proxies /api/ to http://127.0.0.1:8003
```

> **MongoDB Atlas:** whitelist your local IP under Network Access first.

---

## Deployment

> **Which version is live?** The UI shows `v<x.y.z>` in the bottom-left corner of every page (site + admin) — the `version` from `frontend/package.json`, bumped on every code change. After the CI pipeline finishes it should match `package.json` on `main` — if not, the deploy didn't run or the build failed.

Auto-deploy via GitLab CI/CD on push to `main`. On the VPS:

```bash
# /usr/local/bin/deploy-crypto-analysis.sh
cd /root/projects/crypto-analysis
git pull origin main
source crypto-analysis-venv/bin/activate
pip install -r requirements.txt --quiet     # now installs numpy
cd frontend && npm install --silent && npm run build && cd ..
systemctl restart crypto-analysis
```

Check Binance is reachable from the VPS (HTTP 451 means a blocked region):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://data-api.binance.vision/api/v3/ping"   # expect 200
```

Add the blocks from `deploy/nginx-snippet.conf` to the tienmai Nginx server block (unchanged).

**Backtest timers** (one-time install; the units run from the repo directory, so later pulls
update the code they run):

```bash
cd /root/projects/crypto-analysis
cp deploy/crypto-analysis-collect.service deploy/crypto-analysis-collect.timer \
   deploy/crypto-analysis-reweight.service deploy/crypto-analysis-reweight.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now crypto-analysis-collect.timer crypto-analysis-reweight.timer
systemctl start crypto-analysis-collect.service      # first archive now (~1-2 min)
systemctl list-timers 'crypto-analysis-*'            # next runs
journalctl -u crypto-analysis-collect -u crypto-analysis-reweight -n 50   # logs
```

The MongoDB user in `MONGODB_URL` needs read/write on `ca_backtest` too (Atlas default
"readWriteAnyDatabase" has it).
