// Noise-robust season evaluation of the fantasy site method, paired between two forecast sources.
// Run from the repo root:
//   npx tsx research/fantasy-backtest/evaluate.ts [--a <history dir>] [--b <history dir>]
//     [--n 200] [--sigma 0.03] [--jobs 10] [--out <json>]
// --a is the reference (default data/predictions/history), --b the challenger (omit to evaluate
// --a alone). Each season is played N times by run.ts workers (ROBUST_WORKER mode): every asset's
// forecast is multiplied by (1 + e), e ~ N(0, sigma), the same draws for both sources (common
// random numbers), so the paired difference B - A cancels most of the path noise.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SEASONS = [2024, 2025, 2026];
const args = parseArgs(process.argv.slice(2));
const N = Number(args.n ?? 200);
const SIGMA = Number(args.sigma ?? 0.03);
const JOBS = Number(args.jobs ?? 10);
const SOURCE_A = args.a ?? join(ROOT, "data", "predictions", "history");
const SOURCE_B = args.b ?? null;
// Optional chip rule per side (run.ts CHIP_RULE), default none: compare two policies on one forecast.
const RULE: Record<string, string> = { A: args.ruleA ?? "", B: args.ruleB ?? "" };

const started = Date.now();
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (SOURCE_B && SOURCE_A.includes(",")) return combinedMain();
  const sources = SOURCE_B ? { A: SOURCE_A, B: SOURCE_B } : { A: SOURCE_A };
  const tasks = buildTasks(sources);
  const totals = await runPool(tasks);
  const report = summarise(totals, Boolean(SOURCE_B));
  const seconds = (Date.now() - started) / 1000;
  console.log(`N=${N} sigma=${SIGMA} jobs=${JOBS} runtime ${seconds.toFixed(0)} s`);
  console.log("A = " + SOURCE_A + (SOURCE_B ? "\nB = " + SOURCE_B : ""));
  printReport(report);
  if (args.out) {
    const payload = { n: N, sigma: SIGMA, a: SOURCE_A, b: SOURCE_B, seconds, report };
    writeFileSync(args.out, JSON.stringify(payload, null, 1));
  }
}

/**
 * Several builds per variant (comma separated --a and --b, build i of A paired with build i of
 * B). Each pair gives a paired mean difference d_i with its within-build SE s_i. The builds are
 * independent re-simulations, so the spread of d_i holds both the perturbation noise and the
 * rebuild drift: combined SE = SD(d_i) / sqrt(B), judged with Student t on B - 1 degrees of
 * freedom. Between-build variance = max(0, Var(d_i) - mean(s_i^2)).
 */
async function combinedMain() {
  const listA = SOURCE_A.split(",");
  const listB = (SOURCE_B as string).split(",");
  const pairs = [];
  for (let i = 0; i < listA.length; i++) {
    const totals = await runPool(buildTasks({ A: listA[i], B: listB[i] }));
    const report = summarise(totals, true);
    pairs.push(report);
    console.log(`pair ${i + 1}/${listA.length} done (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  const combined = combine(pairs);
  const seconds = (Date.now() - started) / 1000;
  console.log(`builds=${listA.length} N=${N} sigma=${SIGMA} runtime ${seconds.toFixed(0)} s`);
  for (const season of SEASONS) console.log(season, JSON.stringify(combined[season]));
  if (args.out) writeFileSync(args.out, JSON.stringify({ n: N, sigma: SIGMA, a: listA, b: listB, seconds, pairs, combined }, null, 1));
}

function combine(pairs: Record<number, any>[]) {
  const out: Record<number, unknown> = {};
  const builds = pairs.length;
  for (const season of SEASONS) {
    const means = pairs.map((p) => p[season].diff.mean as number);
    const within = pairs.map((p) => (p[season].diff.se as number) ** 2);
    const m = means.reduce((x, y) => x + y, 0) / builds;
    const variance = means.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, builds - 1);
    const withinMean = within.reduce((x, y) => x + y, 0) / builds;
    const between = Math.max(0, variance - withinMean);
    const se = Math.sqrt(variance / builds);
    const t = se > 0 ? m / se : 0;
    const critical = tCritical(builds - 1);
    const perBuild = Math.sqrt(between + withinMean);
    const buildsFor100 = Math.ceil(((critical + 0.84) * perBuild / 100) ** 2);
    out[season] = {
      diffs: means,
      mean: round1(m),
      withinSe: round1(Math.sqrt(withinMean)),
      betweenSd: round1(Math.sqrt(between)),
      se: round1(se),
      t: round2(t),
      critical: round2(critical),
      significant: Math.abs(t) > critical,
      buildsFor100,
    };
  }
  return out;
}

/** Two-sided 5% Student t critical value (df 1 to 10, normal beyond). */
function tCritical(df: number): number {
  const table = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23];
  return df >= 1 && df <= table.length ? table[df - 1] : 1.96;
}

// ------------------------------------------------------------------------------ helpers

interface Task { source: string; dir: string; season: number; first: number; last: number }
type Totals = Record<string, Record<number, Record<number, number>>>;

function buildTasks(sources: Record<string, string>): Task[] {
  const chunk = Math.max(1, Math.ceil((N + 1) / Math.max(1, Math.floor(JOBS / SEASONS.length))));
  const tasks: Task[] = [];
  for (const [source, dir] of Object.entries(sources)) {
    for (const season of SEASONS) {
      for (let first = 0; first <= N; first += chunk) {
        const last = Math.min(N, first + chunk - 1);
        tasks.push({ source, dir, season, first, last });
      }
    }
  }
  return tasks;
}

async function runPool(tasks: Task[]): Promise<Totals> {
  const totals: Totals = {};
  const queue = [...tasks];
  const workers = Array.from({ length: JOBS }, async () => {
    while (queue.length) {
      const task = queue.shift() as Task;
      const result = await runTask(task);
      const bySeason = (totals[task.source] ??= {});
      const bySeed = (bySeason[task.season] ??= {});
      Object.assign(bySeed, result);
    }
  });
  await Promise.all(workers);
  return totals;
}

function runTask(task: Task): Promise<Record<number, number>> {
  const spec = `${task.season}:${task.first}:${task.last}:${SIGMA}`;
  const env = { ...process.env, ROBUST_WORKER: spec, PRED_DIR: task.dir, CHIP_RULE: RULE[task.source] };
  const script = "research/fantasy-backtest/run.ts";
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", script], { cwd: ROOT, env, shell: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.split("\n").find((x) => x.startsWith('{"season"'));
      if (code !== 0 || !line) return reject(new Error(`worker ${spec} failed: ${err || out}`));
      const parsed = JSON.parse(line) as { totals: Record<number, number> };
      resolve(parsed.totals);
    });
  });
}

function summarise(totals: Totals, paired: boolean) {
  const out: Record<number, unknown> = {};
  for (const season of SEASONS) {
    const a = totals.A[season];
    const row: Record<string, unknown> = { A: describe(a) };
    if (paired) {
      const b = totals.B[season];
      const diffs = perturbedSeeds().map((seed) => b[seed] - a[seed]);
      const d = describe(Object.fromEntries(diffs.map((x, i) => [i + 1, x])));
      const se = d.sd / Math.sqrt(diffs.length);
      const z = se > 0 ? d.mean / se : 0;
      const needed100 = Math.ceil(((1.96 + 0.84) * d.sd / 100) ** 2);
      row.B = describe(b);
      row.diff = { ...d, se: round1(se), z: round2(z), significant: Math.abs(z) > 1.96, unperturbed: b[0] - a[0], runsFor100: needed100 };
    }
    out[season] = row;
  }
  return out;
}

function describe(bySeed: Record<number, number>) {
  const values = perturbedSeeds().map((seed) => bySeed[seed]);
  const sorted = [...values].sort((x, y) => x - y);
  const m = values.reduce((x, y) => x + y, 0) / values.length;
  const variance = values.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, values.length - 1);
  return {
    mean: round1(m),
    sd: round1(Math.sqrt(variance)),
    p10: sorted[Math.floor(0.1 * (sorted.length - 1))],
    p90: sorted[Math.ceil(0.9 * (sorted.length - 1))],
    unperturbed: bySeed[0] ?? null,
  };
}

function perturbedSeeds(): number[] {
  return Array.from({ length: N }, (_, i) => i + 1);
}

function printReport(report: Record<number, unknown>) {
  for (const season of SEASONS) console.log(season, JSON.stringify(report[season]));
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
