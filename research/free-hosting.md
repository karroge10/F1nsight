# Can F1nsight run for free in the cloud?

Research date: 2026-10-08. Limits change often; every number below that comes from the web has a
source link, and several sources disagree with each other (flagged where it matters).

## 1. Short answer

**Yes, with one caveat: the live timing service.** Everything except `f1live` can run fully free
and with the PC off:

- **Site:** static export of the Next.js site, rebuilt after each refresh, hosted on
  **Cloudflare Pages / Workers static assets** (free plan allows commercial use, no bandwidth bill).
- **Refresh + predict:** **GitHub Actions** cron on a **public** repo (unlimited standard minutes),
  CPU only, pipeline state kept in **Cloudflare R2** (10 GB free).
- **Retraining:** keep it on the PC after races (it takes about 1.5 minutes on the GPU); a CPU run
  in Actions is also feasible.
- **Live (`f1live`):** needs an always-on process. The only realistic free host is an **Oracle
  Always Free ARM VM**, which in 2026 is smaller (2 OCPU / 12 GB, not 4 / 24) and can be reclaimed
  when idle. If that is too fragile, the live page is the one piece worth paying for (about
  $2 to $5 a month).

## 2. What has to run (measured on 2026-10-08)

| Item | Measured |
| --- | --- |
| `data/serve/f1.sqlite` | 60.5 MB (whole `data/serve` 103 MB, of which `telemetry/` 45 MB) |
| `data/predictions` | 5.6 MB |
| `data/processed` | 61 MB |
| `data/raw` | 1.6 GB (raw FastF1/OpenF1 extracts) |
| `data/fastf1_cache` | 21 GB |
| `site/public` | 613 KB |
| `ml/models` / `ml/cache` | 7.6 MB / 26 MB |
| Telemetry export log | `data/telemetry_export_2018_2025.log` (1.1 MB); exports live in `data/serve/telemetry` (45 MB) |

**How the site reads data.** `site/src/lib/data/sqlite-source.ts` opens `../data/serve/f1.sqlite`
read-only with Node's built-in `node:sqlite` (`DatabaseSync`), caches query results in memory and
drops the cache when the file stamp changes. Predictions and fantasy come from published JSON. So
today it is a Node server reading a local SQLite file at request time. Only `/live` is marked
`force-dynamic`; `/api/fantasy` is a small JSON route. The data only changes when the refresh runs,
so almost every page can be pre-rendered at build time.

**What `refresh.ps1` does** (`python -m f1p.refresh`, then site image scripts). Last full run,
`logs/refresh-last.json`, 2026-10-07, 22.5 minutes on the PC:

| Step | Time | Notes |
| --- | --- | --- |
| history (Jolpica results) | 0.2 s | skipped, nothing new |
| openf1 | 502 s | HTTP downloads, network bound |
| fantasy | 121 s | |
| fastf1 (incremental) | 72 s | downloads only sessions of the last 10 days, then rebuilds `ff1_*` tables |
| predict (`f1ml.predict`) | 655 s | 20,000 sims for the race plus 4,000 horizon sims per remaining race |
| images | seconds | non-fatal |

**GPU or CPU.** `f1ml/simulate.py`, `nn.py`, `evaluate.py` all use
`torch.device("cuda" if torch.cuda.is_available() else "cpu")`, so predict and the Monte Carlo
already fall back to CPU. No cupy. The one hard GPU dependency is `f1ml/gbm.py`
(`DEVICE = "cuda"` for XGBoost), which matters for training; XGBoost runs fine with
`device="cpu"`, `tree_method="hist"`. The GPU is barely used: the training log reports mean GPU
utilisation 8 to 10 percent, so the work is mostly CPU and pandas bound.

**CPU estimate (inference, not measured).** Predict took 655 s on the PC with GPU (the core
forecast line in `predict_publish.log` is 296 s). Because GPU use is low, a CPU-only run on a
4 vCPU GitHub runner should land around 15 to 30 minutes. Whole refresh in Actions: roughly 30 to
45 minutes per run. Run it once to measure before relying on this.

**Retraining** (`ml/reports/train_final_v3.log`): about 94 s total on the GPU (GBM 2 to 5 s, the
set transformer NN 35 to 45 s per base model), peak 1.7 GB VRAM (15 GB in the tuning run). On CPU
expect roughly 5 to 20 minutes. Hyperparameter tuning (`train_tune.log`, studies) is the heavy job
and should stay on the PC.

**FastF1 cache.** The incremental step only fetches sessions of the last 10 days. The 21 GB cache
is only needed for bulk rebuilds and the telemetry export, not for the regular refresh. The refresh
does need the previous state it builds on (`data/processed`, `data/serve`, possibly parts of
`data/raw`, `ml/models`, `logs/refresh_state.json`). Whether `ff1_*` table rebuilds read the full
`data/raw/fastf1` tree (1.6 GB) has to be checked in `build_tables.py`; if they do, 1.6 GB is
still fine to store in R2 and download per run.

**Live service (`live/`).** FastAPI + uvicorn on port 8765, a long-running process that keeps an
outbound WebSocket to the F1 SignalR Core hub (`wss://livetiming.formula1.com/signalrcore`, no
auth for timing; car positions need an F1TV token or a paid OpenF1 account, otherwise it estimates
positions) and serves WebSockets (`/ws/live`) to browsers. Outside sessions it replays archived
sessions from the static archive. Needs to be up only during sessions, but must not be cold.

## 3. Component table (recommended stack)

| Component | Requirements | Recommended free option | Limits that matter | Risks |
| --- | --- | --- | --- | --- |
| Website | Next.js 16, data read at build, about 100 MB of data total, ~17 page templates | Static export (or prerender) to Cloudflare Pages / Workers static assets | Pages: 500 builds/month, 20,000 files, 25 MiB per file; Workers free: 100k requests/day, 10 ms CPU per request ([CF Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Pages limits summary](https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026)) | File count if every season/race/driver page is generated; build must happen in Actions, not in Pages CI |
| Site data at runtime | read-only SQLite, 60 MB | None needed if pages are pre-rendered; else D1 (5 GB free, 5M rows read/day) or R2 | D1 daily caps stop all queries until midnight UTC once hit ([CF D1](https://www.cloudflare.com/en-in/developer-platform/products/d1/), [freetier.co D1](https://freetier.co/articles/cloudflare-d1-free-tier-limits-pricing-and-alternatives)) | D1 would mean rewriting `sqlite-source.ts` to async queries |
| Refresh pipeline | Python, network heavy, 10 to 15 min | GitHub Actions cron, public repo | Standard runners free and unlimited on public repos; private: 2,000 min/month; job max 6 h ([GitHub pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions), [Latchkey](https://latchkey.dev/learn/cost/is-github-actions-free), [usage limits](https://docs.github.com/en/actions/reference/limits)) | Cron delays of several minutes; cron on public repos is disabled after 60 days without repo activity |
| Predict + Monte Carlo | torch CPU, 20k sims | Same Actions job, CPU | 4 vCPU / 16 GB on public repos, 2 vCPU / 8 GB on private (one source, verify) | Estimated 15 to 30 min; no GPU runners on the free plan |
| Pipeline state | 100 MB to 1.7 GB between runs | Cloudflare R2 (10 GB, free egress) | 1M Class A / 10M Class B ops per month ([R2 free tier](https://freetier.co/directory/products/cloudflare-r2)) | Need a lock so two runs do not overwrite each other |
| Retraining | XGBoost (cuda) + set transformer, about 1.5 min GPU | Owner's PC after races (or Actions CPU with `device="cpu"`) | Kaggle about 30 GPU h/week but no supported scheduler; Colab free has no automation ([Kaggle](https://agentdeals.dev/vendor/kaggle), [Colab guide](https://joshthompson.co.uk/ai/google-colab-2026-guide-free-compute-automations-pro-tips/)) | Model in the cloud gets stale if the PC is off for weeks; it keeps working, just older |
| Live timing | always-on process, outbound WSS + inbound WebSockets | Oracle Always Free A1 VM (2 OCPU / 12 GB) | Idle reclaim if 95th percentile CPU, network and memory all stay under 20 percent for 7 days ([Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [InfoQ on the 2026 cut](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)) | Capacity "out of host" errors at signup, reclaim, policy changes without notice |

### Hosting options compared

| Host | 2026 free status | Fit |
| --- | --- | --- |
| Cloudflare Pages / Workers (OpenNext) | Free, commercial use allowed, unlimited static bandwidth | Best for static. OpenNext SSR on the free plan is tight: 10 ms CPU per request and `node:sqlite` is not available in Workers, so SSR would need D1 |
| Vercel Hobby | Free but "non-commercial, personal use only" ([Vercel Hobby](https://vercel.com/docs/plans/hobby)) | Works technically (SQLite file can be bundled read-only), but ads, affiliate links or donations make it commercial |
| Netlify | 300 credits/month, hard pause when used up; about 15 GB bandwidth, 15 credits per production deploy, so about 20 deploys/month ([netli.fyi](https://netli.fyi/blog/netlify-free-plan-limits-2026), [costbench](https://costbench.com/software/cloud-infrastructure/netlify/free-plan/)) | A busy race weekend with several deploys could pause the site |
| GitHub Pages | Free, static only, 1 GB site, soft 100 GB/month bandwidth | Fine for a static export; no headers control, public repo needed on the free plan |
| Render | Free web service sleeps after 15 min idle, 30 to 60 s cold start, 750 h/month ([Render](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)) | Poor for live (cold start, sleeping drops the outbound feed) |
| Fly.io | No free tier for new accounts, trial only; smallest machine about $2.19/month ([costbench](https://costbench.com/software/cloud-infrastructure/fly-io/free-plan/), [runxbuild](https://www.runxbuild.com/blog/fly-io-pricing/)) | Good cheap paid host for live |
| Railway | $5 trial, then $1 credit/month, 0.5 GB RAM ([saaspricepulse](https://www.saaspricepulse.com/tools/railway)) | $1 is not enough for an always-on service |
| Koyeb | Free instance being removed for new users after the Mistral acquisition; scales to zero after 1 h ([agentdeals issue](https://github.com/robhunter/agentdeals/issues/2218), [srvrlss](https://www.srvrlss.io/provider/koyeb/)) | Not reliable in 2026 |
| Oracle Always Free | A1 cut to 2 OCPU / 12 GB in 2026, plus 2 AMD micro VMs, 200 GB block storage ([InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Oracle FAQ](https://www.oracle.com/cloud/free/faq/)) | Only free option that can host everything, including live |

Scheduling: Cloudflare Cron Triggers are free (up to 5 per account on free) but run Workers with
the 10 ms CPU limit, so they can only *trigger* a GitHub workflow (`workflow_dispatch` via the API),
never run Python. That is actually useful: a Cloudflare cron is more punctual than the GitHub cron.

## 4. Alternative stacks

**A. Fully free, simplest (recommended).** Public GitHub repo; Actions cron runs refresh + predict
on CPU, pulls and pushes state from R2, builds the static site, deploys to Cloudflare Pages with
`wrangler pages deploy`. Retrain on the PC, upload `ml/models` to R2. Live page hidden or showing
"replay only from archive" (replay could be pre-generated JSON). Cost: $0.

**B. Fully free, most robust for features (Oracle VM).** One A1 VM (2 OCPU / 12 GB, Ubuntu ARM)
runs everything: `next start`, `f1live` behind Caddy (TLS + WebSockets), and a systemd timer for
`refresh`. Data on the 200 GB block volume (room for the 21 GB FastF1 cache). Put Cloudflare
(free proxy) in front for caching and to hide the IP. PyTorch and XGBoost have ARM64 Linux wheels,
CPU only. The refresh and the live relay keep utilisation above the reclaim threshold during
weekends, but between races it can look idle. Cost: $0, with the reclaim and capacity risk.

**C. Cheap paid, if free is too fragile.** Stack A for the site and pipeline, plus `f1live` on a
small always-on VM: Hetzner CX22 or CAX11 (about EUR 4 to 5 a month), or Fly.io shared-cpu-1x
256 MB (about $2 to $3 a month). Optional: private repo with GitHub Pro for $4/month (3,000
minutes) if the code should not be public. Total about $3 to $9 a month. Converting the Oracle
account to Pay As You Go (still $0 if you stay within free limits) also removes the idle reclaim.

## 5. Code changes for the recommended stack (A)

1. **Site build mode.** Add `output: "export"` (or keep the server build but prerender every route
   with `generateStaticParams`) so all pages read SQLite at build time. Replace `/api/fantasy` with
   a static JSON file. `/live` becomes a client page that connects to the live host via an env URL
   (`NEXT_PUBLIC_LIVE_URL`) or shows a "not available" state.
2. **Data paths.** `F1_DATA_DIR` already exists; point it at the workspace copy pulled from R2.
   The Windows idle-close logic in `sqlite-source.ts` is harmless on Linux.
3. **Linux entry point for refresh.** `refresh.ps1` is PowerShell and expects
   `pipeline/.venv/Scripts/python.exe`; on Linux call `uv run python -m f1p.refresh` directly, then
   the two `node` image scripts. PowerShell Core also exists on runners, but a short bash step is
   simpler.
4. **CPU paths.** `ml/f1ml/gbm.py` hardcodes `DEVICE = "cuda"`; make it fall back to `"cpu"` like
   torch does (only needed if retraining or any XGBoost predict call runs in the cloud). Install
   the CPU wheel of torch in CI (`--index-url https://download.pytorch.org/whl/cpu`) to save about
   2 GB of download.
5. **State sync.** A small script: before the run, download `data/serve`, `data/processed`,
   `data/predictions`, `ml/models`, `logs/refresh_state.json` (and `data/raw` if the table builds
   need it) from R2; after the run, upload what changed. Use `concurrency:` in the workflow so only
   one refresh runs at a time (the existing lock files are local only).
6. **Workflow** `.github/workflows/refresh.yml`: `schedule` cron every 1 to 3 hours on race
   weekends (Friday to Monday) plus daily otherwise, plus `workflow_dispatch`; steps: checkout,
   setup uv and node, pull state, refresh, `next build`, `wrangler pages deploy`, push state.
   Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, R2 keys, optional `F1TV_SUBSCRIPTION_TOKEN`.
7. **FastF1 cache in CI.** Start empty each run (or keep the last 10 days in `actions/cache`, 10 GB
   per repo). Only current weekend sessions are downloaded.

## 6. Gotchas

- **Oracle reclaim and the 2026 cut.** Free A1 is now 2 OCPU / 12 GB total; tenancies above it get
  instances disabled and deleted after 30 days. Idle instances (under 20 percent CPU, network and
  memory at the 95th percentile over 7 days) can be reclaimed. New A1 capacity is often
  unavailable in popular regions. Keep backups in R2 and an infrastructure script to rebuild.
- **Vercel's commercial rule.** Hobby is personal and non-commercial only. Ads, sponsorships,
  affiliate links or paid features break it; Cloudflare's free plan has no such rule.
- **Public repos expose code.** Unlimited free Actions minutes need a public repo, so the model
  code, features and tuning become public. Never commit `data/` or tokens; `ml/models` can stay in
  R2 instead of git. Private repo alternative: 2,000 min/month on 2 vCPU runners, which is about
  40 to 60 refresh runs a month at the estimated length, enough for race weekends only if the
  schedule is tight.
- **Scheduled workflows** are disabled after 60 days of no repository activity on public repos and
  can be delayed or dropped at busy times. A Cloudflare Cron Trigger calling `workflow_dispatch`
  is a good backup.
- **Secrets.** Use GitHub encrypted secrets; workflows triggered from forks do not get them. The
  F1TV subscription token is personal and expires; keep it out of logs (live service only).
- **FastF1, OpenF1 and Jolpica rate limits from shared IPs.** GitHub runners share IP ranges with
  many other users. FastF1 enforces its own limits (about 500 calls/hour on the Ergast/Jolpica
  backend) and OpenF1 and Jolpica can throttle; the openf1 step already takes 8 minutes. Keep the
  incremental windows small, cache responses, and treat 429 as "retry next run", not failure.
- **F1 live timing auth.** Timing topics are anonymous, positions and car data need an F1TV token
  (personal account, terms of service do not cover redistribution), and OpenF1 live needs a paid
  account. A public site relaying the feed is a grey area; the estimated-positions mode avoids the
  token entirely.
- **Cloudflare Workers runtime.** If you later go SSR with OpenNext, `node:sqlite` and filesystem
  reads do not work in Workers; data must move to D1 (async API) or be bundled as JSON. Free plan
  10 ms CPU per request is tight for SSR pages that run many queries.
- **Estimates.** CPU predict time is an estimate from the code and logs, not a measurement. Do one
  manual Actions run first.

## Sources

- GitHub Actions: <https://github.com/resources/insights/2026-pricing-changes-for-github-actions>,
  <https://latchkey.dev/learn/cost/is-github-actions-free>, <https://docs.github.com/en/actions/reference/limits>
- Cloudflare: <https://developers.cloudflare.com/workers/platform/pricing/>,
  <https://www.cloudflare.com/en-in/developer-platform/products/d1/>,
  <https://freetier.co/articles/cloudflare-d1-free-tier-limits-pricing-and-alternatives>,
  <https://freetier.co/directory/products/cloudflare-r2>,
  <https://temps.sh/blog/cloudflare-pages-free-tier-limits-2026>,
  <https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/>
- Vercel: <https://vercel.com/docs/plans/hobby>
- Netlify: <https://netli.fyi/blog/netlify-free-plan-limits-2026>, <https://costbench.com/software/cloud-infrastructure/netlify/free-plan/>
- Render: <https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026>
- Fly.io: <https://costbench.com/software/cloud-infrastructure/fly-io/free-plan/>, <https://www.runxbuild.com/blog/fly-io-pricing/>
- Railway: <https://www.saaspricepulse.com/tools/railway>
- Koyeb: <https://github.com/robhunter/agentdeals/issues/2218>, <https://www.srvrlss.io/provider/koyeb/>
- Oracle: <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>,
  <https://www.oracle.com/cloud/free/faq/>, <https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/>
- Kaggle / Colab: <https://agentdeals.dev/vendor/kaggle>,
  <https://joshthompson.co.uk/ai/google-colab-2026-guide-free-compute-automations-pro-tips/>
