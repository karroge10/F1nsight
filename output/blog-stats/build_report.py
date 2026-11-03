import base64
import csv
import html
import json
import shutil
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent
coverage = json.loads((ROOT / "coverage.json").read_text())
cloud = coverage["sources"][1]
backtest = json.loads((ROOT / "data/predictions/backtest.json").read_text())
summary = json.loads((ROOT / "backtest-summary.json").read_text())
stages = ["pre-weekend", "post-practice", "post-qualifying"]
stage_names = ["Before weekend", "After practice", "After qualifying"]
n = len(backtest["races"])
totals = cloud["database_totals"]
telemetry = cloud["telemetry_totals"]
charts = ROOT / "charts"
charts.mkdir(exist_ok=True)
tables = ROOT / "tables"
tables.mkdir(exist_ok=True)


def write_csv(name, fields, rows):
    with (tables / name).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


metric_rows = []
for key, row in backtest["summary"]["stages"].items():
    metric_rows.append({"method": key, **{k: row[k] for k in ["winnerCorrect", "podiumHits", "spearman", "mae", "logLossWin", "brierWin"]}})
for key, row in backtest["summary"]["baselines"].items():
    metric_rows.append({"method": key, **{k: row.get(k) for k in ["winnerCorrect", "podiumHits", "spearman", "mae", "logLossWin", "brierWin"]}})
write_csv("model-metrics.csv", list(metric_rows[0]), metric_rows)
season_rows = [{"season": int(y), **row} for y, row in cloud["per_season"].items()]
write_csv("archive-by-season.csv", [k for k in season_rows[0] if k != "session_codes"], [{k: v for k, v in r.items() if k != "session_codes"} for r in season_rows])


def theme(dark):
    bg, fg, muted, grid = ("#101214", "#f4f2ed", "#a8afb8", "#343940") if dark else ("#ffffff", "#172029", "#596571", "#dce1e6")
    plt.rcParams.update({"figure.facecolor": bg, "axes.facecolor": bg, "savefig.facecolor": bg,
                         "text.color": fg, "axes.labelcolor": muted, "xtick.color": muted, "ytick.color": muted,
                         "axes.edgecolor": grid, "grid.color": grid, "font.family": "DejaVu Sans",
                         "font.size": 12, "axes.spines.top": False, "axes.spines.right": False,
                         "axes.spines.left": False, "axes.spines.bottom": False,
                         "svg.fonttype": "none"})
    return fg, muted, grid


def save(fig, name, title, subtitle, dark):
    fig.suptitle(title, x=.075, y=.97, ha="left", fontsize=23, fontweight="bold")
    fig.text(.075, .895, subtitle, fontsize=11, color=plt.rcParams["axes.labelcolor"])
    fig.text(.075, .025, "F1nsight  /  23 OCT 2026", fontsize=10, color=plt.rcParams["axes.labelcolor"])
    folder = charts if dark else charts / "light"
    folder.mkdir(exist_ok=True)
    fig.savefig(folder / f"{name}.png", dpi=200)
    fig.savefig(folder / f"{name}.svg")
    plt.close(fig)


for dark in [True, False]:
    fg, muted, grid = theme(dark)
    accent, blue, gray = ("#ff6559", "#70b9ff", "#76828e") if dark else ("#ce3a2e", "#186fc1", "#8b98a5")
    fig, ax = plt.subplots(figsize=(12, 6.75))
    fig.subplots_adjust(left=.075, right=.965, bottom=.16, top=.8)
    decades = {}
    for year, row in cloud["per_season"].items():
        decade = int(year) // 10 * 10
        decades[decade] = decades.get(decade, 0) + row["result_races"]
    labels = [f"{d}s" if d != 2020 else "2020–26*" for d in decades]
    bars = ax.bar(labels, list(decades.values()), color=[gray] * (len(labels) - 1) + [accent], width=.62)
    ax.bar_label(bars, padding=9, fontsize=13, color=fg)
    ax.set_ylim(0, max(decades.values()) * 1.2)
    ax.set_ylabel("Races with results")
    ax.grid(axis="y", alpha=.45)
    ax.set_axisbelow(True)
    save(fig, "01-archive", "An archive spanning 77 seasons", "1,166 races with results, 1950–2026. *2026 through round 17; later rounds are scheduled only.", dark)

    fig, ax = plt.subplots(figsize=(12, 6.75))
    fig.subplots_adjust(left=.075, right=.96, bottom=.17, top=.78)
    x = np.arange(3)
    for offset, key, label, color in [(-.19, "winnerCorrect", "Winner picked correctly", accent), (.19, "podiumHits", "Predicted podium slots correct", blue)]:
        values = [backtest["summary"]["stages"][s][key] * 100 for s in stages]
        bars = ax.bar(x + offset, values, .34, label=label, color=color)
        ax.bar_label(bars, labels=[f"{v:.1f}%" for v in values], padding=7, color=fg, fontsize=13)
    ax.set_xticks(x, stage_names)
    ax.set_ylim(0, 100)
    ax.set_ylabel("Percent")
    ax.grid(axis="y", alpha=.4)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, loc="upper left", ncols=2)
    save(fig, "02-forecast-stages", "More weekend information improves the forecast", "Walk-forward backtest, 65 races. Winner picks: 18 → 22 → 36 correct; podium hit rate counts slots, not full podiums.", dark)

    fig, axes = plt.subplots(1, 3, figsize=(12, 6.75))
    fig.subplots_adjust(left=.075, right=.98, bottom=.23, top=.76, wspace=.47)
    methods = [backtest["summary"]["stages"]["post-qualifying"], backtest["summary"]["baselines"]["grid"]]
    for ax, key, label, limit, fmt in zip(axes, ["winnerCorrect", "spearman", "logLossWin"], ["Winner picks ↑", "Field ranking ↑", "Win log loss ↓"], [1, 1, 2], [".1%", ".3f", ".3f"]):
        values = [m[key] for m in methods]
        bars = ax.bar(["Model", "Grid baseline"], values, color=[accent, gray], width=.6)
        ax.bar_label(bars, labels=[format(v, fmt) for v in values], padding=8, color=fg, fontsize=14)
        ax.set_ylim(0, limit)
        ax.set_title(label, fontsize=14, loc="left", pad=22)
        ax.grid(axis="y", alpha=.35)
        ax.set_axisbelow(True)
    save(fig, "03-model-vs-grid", "A better probability forecast is not always a better pick", "Same 65 races, after qualifying. Grid wins on top picks and MAE; model wins on rank correlation and win log loss.", dark)

    fig, ax = plt.subplots(figsize=(12, 6.75))
    fig.subplots_adjust(left=.075, right=.96, bottom=.17, top=.79)
    years = [2024, 2025, 2026]
    x = np.arange(3)
    for offset, name, color in [(-.19, "Model", accent), (.19, "Grid baseline", gray)]:
        values = [(summary["bySeason"]["post-qualifying"][str(y)] if name == "Model" else summary["baselines"]["gridBySeason"][str(y)])["winnerCorrect"] * 100 for y in years]
        bars = ax.bar(x + offset, values, .34, label=name, color=color)
        ax.bar_label(bars, labels=[f"{v:.1f}%" for v in values], padding=7, color=fg)
    ax.set_xticks(x, ["2024 · 24 races", "2025 · 24 races", "2026 · 17 races"])
    ax.set_ylim(0, 100)
    ax.set_ylabel("Correct winner picks (%)")
    ax.legend(frameon=False, ncols=2, loc="upper left")
    ax.grid(axis="y", alpha=.4)
    ax.set_axisbelow(True)
    save(fig, "04-season-comparison", "Accuracy changes substantially from season to season", "After-qualifying winner picks. 2026 is a partial season; these are historical tests, not prospective live results.", dark)

    fig, ax = plt.subplots(figsize=(12, 6.75))
    fig.subplots_adjust(left=.075, right=.965, bottom=.16, top=.8)
    telemetry_years = [y for y, row in cloud["per_season"].items() if row["sessions"]]
    values = [cloud["per_season"][y]["sessions"] for y in telemetry_years]
    bars = ax.bar(telemetry_years, values, color=[gray] * (len(values) - 1) + [accent], width=.62)
    ax.bar_label(bars, padding=8, color=fg)
    ax.set_ylim(0, 75)
    ax.set_ylabel("Exported sessions")
    ax.grid(axis="y", alpha=.4)
    ax.set_axisbelow(True)
    save(fig, "05-telemetry-coverage", "326 sessions of explorable telemetry", "2018–2026. 6,437 driver-session fastest laps; 320 points per trace. Historical coverage is uneven; 2026 is partial.", dark)

    payload = json.loads((ROOT.parents[1] / "data/serve/telemetry/2026/17_Q.json").read_text())
    fig, ax = plt.subplots(figsize=(12, 6.75))
    fig.subplots_adjust(left=.075, right=.965, bottom=.17, top=.79)
    traces = []
    for code, color in [("NOR", "#f79422"), ("VER", blue)]:
        driver = next(d for d in payload["drivers"] if d["code"] == code)
        distance = np.linspace(0, driver["length"], len(driver["speed"]))
        ax.plot(distance, driver["speed"], color=color, lw=1.9, label=f"{code} · {driver['lapTimeMs'] / 1000:.3f} s")
        traces.extend({"driver": code, "distance_m": round(float(d), 2), "speed_kmh": s} for d, s in zip(distance, driver["speed"]))
    ax.set_xlim(0, max(d["distance_m"] for d in traces))
    ax.set_ylim(0, 350)
    ax.set_xlabel("Distance along each driver's fastest lap (m)")
    ax.set_ylabel("Speed (km/h)")
    ax.legend(frameon=False, ncols=2, loc="lower right")
    ax.grid(alpha=.35)
    save(fig, "06-singapore-telemetry", "Two fastest laps, compared metre by metre", "Singapore 2026 qualifying, FastF1 export. 320 resampled points per driver; not raw high-frequency sensor data.", dark)
    if dark:
        write_csv("singapore-speed-traces.csv", ["driver", "distance_m", "speed_kmh"], traces)

model = backtest["summary"]["stages"]["post-qualifying"]
grid = backtest["summary"]["baselines"]["grid"]
report_data = {"asOf": "2026-10-23", "coverage": totals, "telemetry": telemetry,
               "backtestRaces": n, "backtestGeneratedAt": backtest["generatedAt"],
               "metrics": backtest["summary"], "winLogLossReductionVsGrid": 1 - model["logLossWin"] / grid["logLossWin"],
               "winnerPicks": {s: int(sum(r["stages"][s]["winnerCorrect"] for r in backtest["races"])) for s in stages}}
(ROOT / "report-data.json").write_text(json.dumps(report_data, indent=2), encoding="utf-8")


def uri(name):
    return "data:image/png;base64," + base64.b64encode((ROOT / name).read_bytes()).decode()


def figure(name, caption):
    return f'<figure><a href="{name}"><img src="{uri(name)}" alt="{html.escape(caption)}" loading="lazy"></a><figcaption>{caption}</figcaption></figure>'


sources = [
    ("Jolpica", "Race results, standings, schedules, lap times and pit stops. The archive's historical backbone.", "https://api.jolpi.ca/docs/", "Active"),
    ("F1DB", "Fills historical and session-result gaps; shared IDs are normalized before serving and training.", "https://github.com/f1db/f1db", "Active"),
    ("FastF1", "Session laps, sectors, tyres, telemetry and track positions. The site exports each driver's fastest lap.", "https://docs.fastf1.dev/", "Active"),
    ("OpenF1", "Historical laps, stints, pits, positions, overtakes and weather. Free historical API; live access has separate requirements.", "https://openf1.org/docs/", "Active"),
    ("FIA + race control", "Announced grid penalties, with manual overrides. These alter the simulated starting grid.", "https://www.fia.com/events/fia-formula-one-world-championship", "Active"),
    ("F1 Fantasy + DHL", "Public fantasy prices and points, plus pit-stop information. Some fantasy scoring components are reconstructed.", "https://fantasy.formula1.com/", "Active"),
    ("Polymarket", "Winner-market probabilities, when a usable event exists. Logarithmic pooling: 20% model weight before the weekend, 35% afterward.", "https://gamma-api.polymarket.com/docs", "Live forecast"),
    ("Open-Meteo", "Observed weather and timestamped forecasts are archived. Weather is not yet an active production prediction feature.", "https://open-meteo.com/en/docs/historical-weather-api", "Research"),
    ("F1 live timing", "SignalR timing, race control and weather for the live service. Live car positions are estimated and labelled.", "https://github.com/karroge10/F1nsight/blob/5a0aab8/live/README.md", "Live service")
]
source_table = ''.join(f'<tr><td><a href="{url}">{name}</a></td><td>{use}</td><td>{status}</td></tr>' for name, use, url, status in sources)
method_table = ''.join(f'<tr><td>{label}</td><td>{row["winnerCorrect"]:.1%}</td><td>{row["podiumHits"]:.1%}</td><td>{row["spearman"]:.3f}</td><td>{row["mae"]:.2f}</td><td>{row.get("logLossWin", float("nan")):.3f}</td></tr>' for label, row in [
    ("Model: pre-weekend", backtest["summary"]["stages"]["pre-weekend"]),
    ("Model: post-practice", backtest["summary"]["stages"]["post-practice"]),
    ("Model: post-qualifying", model),
    ("Grid baseline", grid),
    ("Championship baseline", backtest["summary"]["baselines"]["championship"]),
    ("Recent-form baseline", backtest["summary"]["baselines"]["form3"])])
css = '''
:root{color-scheme:dark;--bg:#101214;--fg:#f4f2ed;--muted:#a8afb8;--line:#343940;--red:#ff6559;--panel:#191d22}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:Arial,sans-serif;font-size:17px;line-height:1.6}main{max-width:1200px;margin:auto;padding:60px 32px 90px}a{color:inherit;text-underline-offset:4px}header{padding-bottom:45px;border-bottom:1px solid var(--line)}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--red)}h1{font-size:clamp(44px,7vw,86px);line-height:1.02;letter-spacing:-.05em;max-width:950px;margin:22px 0}h2{font-size:34px;line-height:1.12;letter-spacing:-.025em;margin:0 0 20px}h3{font-size:22px;line-height:1.2}p{max-width:850px}header p{font-size:21px;color:var(--muted);max-width:810px}.meta{font-size:13px;color:var(--muted)}section{padding:44px 0;border-bottom:1px solid var(--line)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;margin:32px 0}.stat{border-top:2px solid var(--line);padding-top:16px}.stat strong{font-size:48px;line-height:1.2;letter-spacing:-.04em;display:block}.stat span{color:var(--muted);font-size:14px}figure{margin:26px 0}img{width:100%;height:auto;display:block;border-radius:6px}figcaption{font-size:13px;color:var(--muted);margin-top:10px;max-width:900px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.grid figure{margin:12px 0}.callout{border-left:3px solid var(--red);background:var(--panel);padding:20px 24px;margin:26px 0}.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.flow div{background:var(--panel);padding:20px 18px;border-top:2px solid var(--red)}.flow b{display:block;font-size:16px}.flow span{display:block;color:var(--muted);font-size:13px;margin-top:8px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:14px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}td:first-child{font-weight:600}td:last-child{white-space:nowrap}.source-table td:nth-child(2){width:65%}.caption-label{color:var(--red);font-size:12px;letter-spacing:.1em;text-transform:uppercase}.roadmap{counter-reset:roadmap;padding:0;list-style:none}.roadmap li{counter-increment:roadmap;padding:20px 0 20px 48px;position:relative;border-top:1px solid var(--line)}.roadmap li:before{content:counter(roadmap,decimal-leading-zero);position:absolute;left:0;color:var(--red);font-variant-numeric:tabular-nums}.roadmap b{display:block}.roadmap span{color:var(--muted)}.downloads{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}.downloads a{padding:10px 16px;background:var(--panel);font-size:14px;border-radius:4px;text-decoration:none}.note{color:var(--muted);font-size:14px}code{font-size:.9em;color:#b7d9f9}footer{padding-top:30px;color:var(--muted);font-size:13px}@media(max-width:700px){main{padding:30px 18px}.stats{grid-template-columns:repeat(2,1fr);gap:20px}.stat strong{font-size:36px}.flow,.grid{grid-template-columns:1fr}h2{font-size:29px}section{padding:32px 0}}@media print{body{background:white;color:#172029}main{padding:0}.note,figcaption,.meta{color:#596571}section{break-inside:avoid}}
'''
report = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F1nsight: a Formula 1 data project in numbers</title><style>{css}</style></head><body><main>
<header><div class="eyebrow">F1nsight / build notes / 23 October 2026</div><h1>Seventy-seven seasons.<br>One connected pit wall.</h1><p>A blog research pack about the data, engineering and prediction record behind F1nsight, with real product screenshots and reusable figures.</p><div class="meta">Measured from cloud state and the published model backtest. Product screenshots captured 23 October 2026. No audience or traffic estimates.</div><div class="downloads"><a href="blog-draft.md">Read the blog draft</a><a href="report-data.json">Download verified numbers</a><a href="tables/model-metrics.csv">Model metrics CSV</a><a href="assets.zip">All blog assets</a></div></header>
<section><div class="eyebrow">01 / the scale</div><h2>A small site with a long memory</h2><div class="stats"><div class="stat"><strong>77</strong><span>seasons represented, 1950–2026</span></div><div class="stat"><strong>1,166</strong><span>races with recorded results</span></div><div class="stat"><strong>635,331</strong><span>lap-time rows</span></div><div class="stat"><strong>881</strong><span>driver catalog records</span></div><div class="stat"><strong>12,881</strong><span>pit-stop records</span></div><div class="stat"><strong>326</strong><span>exported telemetry sessions</span></div></div><p>The database also holds 214 constructor and 78 circuit records, 26,247 race-result rows and 1,172 scheduled race records. Those six scheduled races without results are not counted as completed races.</p>{figure('charts/01-archive.png', 'Completed-race coverage by decade. A season in the database does not imply every data type is available for that season.')}</section>
<section><div class="eyebrow">02 / the engineering</div><h2>Build once, serve static files</h2><p>Python ingestion normalizes several public feeds into Parquet and SQLite. The modelling layer produces forecast and fantasy JSON. Next.js and React prerender the site, then Cloudflare Pages serves the static export. The live timing relay is a separate FastAPI and WebSocket service.</p><div class="flow"><div><b>01 / Collect</b><span>Jolpica, F1DB, FastF1, OpenF1, FIA, fantasy feeds</span></div><div><b>02 / Normalize</b><span>Python, Parquet, canonical IDs, SQLite, compact telemetry JSON</span></div><div><b>03 / Forecast</b><span>XGBoost + set transformer + retirements + Monte Carlo</span></div><div><b>04 / Publish</b><span>Next.js static export → Cloudflare Pages; separate live relay</span></div></div><p>GitHub Actions performs refreshes and retraining. A Cloudflare cron Worker dispatches checks, with GitHub schedules as a backup. Data persists in versioned GitHub release assets; refresh and retraining write separate groups. A promotion gate compares a candidate with the published backtest before replacing the model.</p><p class="note">The standard forecast requests 20,000 Monte Carlo simulations. That is a sampling budget, not an accuracy guarantee. The current serving path is verified in <code>site/next.config.ts</code>; older overview prose in the README describes an earlier request-time rendering design.</p>{figure('forecast.png', 'The public forecast page, captured 23 October 2026. These are current model outputs, not race results.')}</section>
<section><div class="eyebrow">03 / the record</div><h2>Better forecasts, without pretending F1 is predictable</h2><p>The published test covers 65 races: 24 in 2024, 24 in 2025 and 17 in 2026. It uses a walk-forward setup, training on earlier races and refreshing the model every three rounds. These are retrospective out-of-sample tests, not 65 forecasts logged live before the races.</p>{figure('charts/02-forecast-stages.png', 'The model chooses the eventual winner in 18 of 65 races before the weekend and 36 of 65 after qualifying. Podium hit rate is the share of three predicted podium slots filled correctly, not the chance of a perfect podium.')}{figure('charts/03-model-vs-grid.png', 'After qualifying, the model improves win log loss by 22.4% versus the grid probability baseline. The grid baseline still picks more winners: 39/65 versus 36/65. Lower log loss rewards useful probabilities, not just the highest-ranked pick.')}<div class="callout"><strong>The claim worth publishing:</strong> After qualifying, the model ranks the field slightly better than the grid and gives the eventual winner better probabilities on average. It does not beat the grid on every metric.</div><div class="table-wrap"><table><thead><tr><th>Method</th><th>Winner ↑</th><th>Podium slots ↑</th><th>Spearman ↑</th><th>MAE ↓</th><th>Win log loss ↓</th></tr></thead><tbody>{method_table}</tbody></table></div><p class="note">Spearman measures agreement with the finishing order. MAE is average position error. The grid baseline orders drivers by starting position, with win/podium probabilities learned from historical grid slots. The recent-form baseline has no probabilistic win log loss; “nan” means unavailable. Stage comparisons reflect different information available at prediction time.</p>{figure('charts/04-season-comparison.png', 'Season breakdown exposes variation hidden by the overall average. Small samples and a partial 2026 season limit conclusions; no confidence interval or significance claim is implied.')}</section>
<section><div class="eyebrow">04 / the sources</div><h2>External information, with a clear job for each feed</h2><div class="table-wrap"><table class="source-table"><thead><tr><th>Source</th><th>How F1nsight uses it</th><th>Status</th></tr></thead><tbody>{source_table}</tbody></table></div><div class="callout"><strong>A live forecast is not the core backtest.</strong> The current prediction path can pool model and market probabilities. The pre-weekend pool uses model exponent 0.20 and market exponent 0.80; later stages use 0.35 and 0.65. These are logarithmic pooling exponents, not linear shares. The 65-race charts above describe the core published backtest, not prospective proof of this live market blend.</div><p>FIA decisions supply concrete news such as penalties. General articles, rumours and team upgrade reports are not parsed into structured features. Market prices may reflect that information indirectly, but the site cannot attribute a price move to a particular news story. Weather is collected for research and is not yet an active predictive feature.</p></section>
<section><div class="eyebrow">05 / the detail</div><h2>From a result row to a lap you can inspect</h2><p>The telemetry export contains 6,437 driver-session fastest-lap entries and 2,059,840 speed values. Each trace is resampled to 320 points. These counts describe the site's compact exports, not full-session raw sensor measurements or 6,437 unique drivers.</p>{figure('charts/05-telemetry-coverage.png', 'Coverage is uneven across years and session types. The 2026 count includes the four Singapore sessions restored on 23 October.')}{figure('charts/06-singapore-telemetry.png', 'Actual exported Singapore qualifying traces for Norris and Verstappen. Relative distance is calculated independently for each lap.')}{figure('telemetry.png', 'The public telemetry explorer, Singapore qualifying: speed, throttle, brake, time gap and a track map. Full-resolution source: 3200 × 2200 px.')}<p>A missing Singapore export exposed a useful engineering failure: results were marked complete, while the derived telemetry file was absent. Cloud runners discarded the cache, so repeating an offline export could never heal it. The repair restores the four files and lets refreshes fetch missing telemetry from the past 14 days, even for sessions whose results already exist.</p><div class="grid">{figure('fantasy.png', 'Fantasy planning shares the race simulation layer and public price inputs. This screenshot is a product example, not a measured fantasy return.')}{figure('history.png', 'The historical archive provides champions, records and navigation back to 1950. All screenshots show the deployed site.')}</div></section>
<section><div class="eyebrow">06 / what comes next</div><h2>The next improvements should earn their place</h2><ol class="roadmap"><li><b>Log every live forecast before the session</b><span>Freeze timestamps, input versions and model/market components. Score untouched future races separately from development backtests.</span></li><li><b>Prove the value of market information</b><span>Compare model-only, market-only and pooled forecasts at identical lead times. Include liquidity, missing-market fallbacks and paired uncertainty estimates.</span></li><li><b>Evaluate weather without future information</b><span>Use the timestamped forecast available before each race, not the weather that actually happened. Add it only if it improves a held-out test.</span></li><li><b>Measure confidence and season drift</b><span>Add race-level bootstrap intervals, calibration checks and regime breakdowns. The existing seed tolerances estimate training noise, not full generalization uncertainty.</span></li><li><b>Monitor the completeness of derived data</b><span>Track expected versus exported sessions, stale predictions and source failures. A green workflow should not conceal a missing product feature.</span></li><li><b>Explain fantasy approximation and live estimation</b><span>Evaluate reconstructed scoring components separately. Keep estimated live positions distinct from recorded positions and expose freshness in the UI.</span></li></ol></section>
<section><div class="eyebrow">07 / publication notes</div><h2>Use the numbers with their definitions attached</h2><p>Snapshot date: 23 October 2026. Archive counts come from the cloud serving SQLite database downloaded for the Singapore repair. Telemetry counts include the repaired cloud payload, with all four Singapore endpoints and the live page independently verified. The published backtest was generated 13 October 2026 and ends at race 202617.</p><p>The counts measure product and dataset coverage. Visitor counts, pageviews, uptime, latency, Core Web Vitals and current hosting expenditure were not measured. “Free public sources” does not mean every dataset has the same license or that commercial redistribution is unrestricted.</p><p class="note">Screenshots contain Formula 1 and team assets as displayed by the product. Retain source attribution and the project's non-affiliation notice when preparing the post.</p><div class="downloads"><a href="SOURCE-NOTES.md">Coverage definitions</a><a href="backtest-summary.json">Published backtest summary</a><a href="tables/archive-by-season.csv">Archive CSV</a><a href="tables/singapore-speed-traces.csv">Telemetry CSV</a><a href="screenshots.json">Screenshot provenance</a></div></section><footer>Implementation evidence: <a href="https://github.com/karroge10/F1nsight/tree/5a0aab8">repository snapshot 5a0aab8</a>, especially <code>site/next.config.ts</code>, <code>ml/f1ml/backtest.py</code>, <code>ml/f1ml/predict.py</code>, <code>ml/f1ml/market.py</code>, <code>pipeline/src/f1p/refresh.py</code> and <code>.github/workflows/</code>. External documentation links identify the upstream projects; statements about this site's usage are based on its implementation.</footer>
</main></body></html>'''
report = report.replace('<td>nan</td>', '<td>n/a</td>')
(ROOT / "report.html").write_text(report, encoding="utf-8")
print(json.dumps({"races": n, "completedRaces": totals["result_races"], "telemetrySessions": telemetry["sessions"], "logLossReduction": report_data["winLogLossReductionVsGrid"], "reportBytes": len(report.encode())}))
