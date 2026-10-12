"use client";

// The optimiser's answer, numbers first: a stat row, the suggested team, one compact row per
// transfer (details on demand), the Boost in one line, a chip table and the next races. Long
// explanations live in tooltips or the expandable rows.

import type { ReactNode } from "react";
import type { Market, MarketAsset } from "@/lib/fantasy/engine/market";
import { CHIP_RULES } from "@/lib/fantasy/engine/rules";
import type { ChipId, Recommendation, TeamResult, TransferExplanation } from "@/lib/fantasy/engine/types";
import { chipPlanLine, chipRows, roundLabel, type ChipRow, type RoundInfo } from "@/lib/fantasy/chip-advice";
import { isTeamComplete, type PlannerState } from "@/lib/fantasy/planner-state";
import { formatMoney, formatMoneySigned, formatSigned } from "@/lib/format";
import { DriverPortrait } from "@/components/ui/driver-portrait";
import { TeamLogo } from "@/components/ui/team-logo";
import { Info } from "@/components/ui/info";
import { ProjectionNote } from "@/components/fantasy/projection-note";
import { IconBoost, IconCalendar, IconChip, IconTransfers } from "@/components/icons";

export interface RecommendationMeta {
  codes: Record<string, string>;
  teams: Record<string, string>;
}

interface RecommendationViewProps {
  rec: Recommendation;
  market: Market;
  current: TeamResult | null;
  state: PlannerState;
  meta: RecommendationMeta;
  ms: number | null;
}

/** One row height for every list in the results: 44px on phones, 40px from sm up. */
const ROW = "flex min-h-11 items-center py-0.5 sm:min-h-10";

const CHIP_NAMES = Object.fromEntries(Object.values(CHIP_RULES).map((rule) => [rule.id, rule.name])) as Record<ChipId, string>;

export function RecommendationView({ rec, market, current, state, meta, ms }: RecommendationViewProps) {
  const best = rec.recommended ?? rec.team.best;
  if (!best) return <p className="text-ui text-ink-2">No team fits. Raise the Cost Cap or unlock a pick.</p>;
  const assetById = (id: string) => market.assets[market.byId.get(id) ?? -1] as MarketAsset | undefined;
  const label = (id: string | null) => {
    const asset = id ? assetById(id) : undefined;
    if (!asset) return id ?? "empty";
    return asset.kind === "driver" ? (meta.codes[asset.id] ?? asset.name) : asset.name;
  };
  const rounds = roundInfos(market);
  const rows = [...best.drivers, ...best.constructors].map(assetById).filter((a): a is MarketAsset => Boolean(a));
  const ins = new Set(best.transfersIn);
  const isNewTeam = !isTeamComplete(state);
  const delta = current ? best.expectedPoints - best.penalty - (current.expectedPoints - current.penalty) : null;
  const driverPoints = sumPoints(best.drivers, market);
  const constructorPoints = sumPoints(best.constructors, market);
  const boostPoints = best.expectedPoints - driverPoints - constructorPoints;
  const breakdown = `Drivers ${driverPoints.toFixed(1)}, constructors ${constructorPoints.toFixed(1)}, boosts and chip ${boostPoints.toFixed(1)}.`;
  const rangeText = `${best.stats.p10.toFixed(0)} to ${best.stats.p90.toFixed(0)}`;
  const chipName = best.chip ? CHIP_RULES[best.chip].name : null;
  const chipAdvice = best.chip ? rec.chips.advice.find((a) => a.chip === best.chip) : undefined;
  const chipGain = chipAdvice && chipAdvice.valueNow > 0 ? chipAdvice.valueNow : null;
  const boostLine = boostText(best, label);
  const futureStages = rec.plan.stages.slice(1);
  const chipTable = chipRows(rec.chips, rounds);
  const planLine = chipPlanLine(rec.chips, CHIP_NAMES, rounds);
  const title = isNewTeam ? "Suggested team" : best.transferCount ? "After transfers" : "Keep your team";
  const searchText = `${rec.team.exact ? "Exact" : "Best found"} · ${rec.team.evaluated.toLocaleString("en-GB")} teams${ms !== null ? ` · ${ms.toFixed(0)} ms` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <Card title={title} info={rec.followsPlan ? "Picked for the next 3 races, not just this one." : undefined}>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-6">
          <Stat label="Expected" value={best.expectedPoints.toFixed(1)} info={breakdown} />
          <Stat label="Range" value={rangeText} info="1 weekend in 10 scores below the first number, 1 in 10 above the second." />
          {delta !== null ? <Stat label="vs your team" value={formatSigned(delta, 1)} tone={toneOf(delta)} /> : <Stat label="Cost" value={formatMoney(best.cost)} />}
          <Stat label="Transfers" value={best.penalty ? `${best.transferCount} (−${best.penalty})` : String(best.transferCount)} tone={best.penalty ? "down" : undefined} />
          <Stat label="Value" value={formatMoneySigned(best.expectedValueChange)} tone={toneOf(best.expectedValueChange)} />
          <Stat label="Chip" value={chipName ?? "None"} sub={chipGain !== null ? `${formatSigned(chipGain, 1)} pts` : undefined} tone={chipName ? "up" : undefined} />
        </dl>
        <ul className="mt-4 grid border-t border-rule lg:grid-cols-2 lg:gap-x-8">
          {rows.map((a) => (
            <TeamRow key={a.id} asset={a} meta={meta} isIn={ins.has(a.id)} boost={best.extraBoost === a.id ? "x3" : best.boost === a.id ? "x2" : null} />
          ))}
        </ul>
        {boostLine ? (
          <p className="mt-3 flex items-center gap-1.5 text-caption text-ink-2">
            <IconBoost size="0.875rem" className="text-ink-3" /> {boostLine}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
        <Card title="Transfers" icon={<IconTransfers size="1rem" className="text-ink-3" />}>
          {rec.explanations.length ? (
            <ul className="border-t border-rule">
              {rec.explanations.map((x, i) => (
                <TransferRow key={i} transfer={x} label={label} assetById={assetById} windowRaces={rec.plan.stages.length} />
              ))}
            </ul>
          ) : (
            <p className={ROW + " border-t border-rule text-ui text-ink-2"}>{isNewTeam ? "New team: no transfers counted." : "No transfers this week."}</p>
          )}
        </Card>

        {futureStages.length ? (
          <Card title="Next races" icon={<IconCalendar size="1rem" className="text-ink-3" />} grow>
            <ul className="border-t border-rule">
              {futureStages.map((s) => (
                <li key={s.round} className={ROW + " grid grid-cols-[5.5rem_minmax(0,1fr)_4rem] gap-3 shadow-[inset_0_-1px_0_var(--rule)] text-ui last:shadow-none"}>
                  <span className="timing text-caption text-ink-3">{roundLabel(s.round, rounds)}</span>
                  <span className="min-w-0 text-ink-2 [overflow-wrap:anywhere]">
                    {s.transferCount ? `${s.transfersOut.map(label).join(", ")} → ${s.transfersIn.map(label).join(", ")}` : "No transfers"}
                    {s.chip ? ` · ${CHIP_RULES[s.chip].name}` : ""}
                  </span>
                  <span className="timing text-end text-ink">{s.expectedPoints.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        </div>

        <Card title="Chips" icon={<IconChip size="1rem" className="text-ink-3" />} info="Extra points from the chip. One chip per race: a chip is held when another wins this weekend or it scores more later.">
          <ChipList rows={chipTable} />
          {planLine ? <p className="timing mt-3 text-caption text-ink-2">{planLine}</p> : null}
        </Card>


      </div>

      {rec.team.alternatives.length > 1 ? (
          <Card title="Close alternatives">
            <ul className="border-t border-rule">
              {rec.team.alternatives.slice(1, 4).map((alt, i) => (
                <li key={i} className={ROW + " grid grid-cols-[minmax(0,1fr)_4.5rem_4rem] gap-3 shadow-[inset_0_-1px_0_var(--rule)] text-ui last:shadow-none"}>
                  <span className="min-w-0 text-ink-2 [overflow-wrap:anywhere]">{[...alt.drivers, ...alt.constructors].map(label).join(" · ")}</span>
                  <span className="timing text-end text-caption text-ink-3">{formatMoney(alt.cost)}</span>
                  <span className="timing text-end text-ink">{alt.expectedPoints.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

      <p className="timing flex flex-wrap gap-x-4 text-caption text-ink-3">
        <span>{searchText}</span>
        <ProjectionNote />
        {rec.synthetic ? <span>Placeholder projections</span> : null}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

/** The one card style of the results: same border, padding and header everywhere. */
function Card({ title, icon, info, grow, children }: { title: string; icon?: ReactNode; info?: string; grow?: boolean; children: ReactNode }) {
  return (
    <section className={"flex min-w-0 flex-col rounded-float border border-rule p-4 " + (grow ? "flex-1" : "h-full")}>
      <h3 className="mb-3 flex h-6 items-center gap-2 text-ui font-[550] text-ink">
        {icon}
        {title}
        {info ? <Info text={info} /> : null}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value, info, tone, sub }: { label: string; value: string; info?: string; tone?: "up" | "down"; sub?: string }) {
  const color = tone === "up" ? "text-delta-up" : tone === "down" ? "text-delta-down" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-1 text-caption text-ink-3">
        {label}
        {info ? <Info text={info} /> : null}
      </dt>
      <dd className={"headline timing text-[1.25rem] leading-tight [overflow-wrap:anywhere] sm:text-[1.5rem] sm:leading-none " + color}>{value}</dd>
      {sub ? <dd className="timing text-caption text-ink-3">{sub}</dd> : null}
    </div>
  );
}

function TeamRow({ asset, meta, isIn, boost }: { asset: MarketAsset; meta: RecommendationMeta; isIn: boolean; boost: "x2" | "x3" | null }) {
  const code = asset.kind === "driver" ? (meta.codes[asset.id] ?? "") : "";
  return (
    <li className={ROW + " grid grid-cols-[2rem_minmax(0,1fr)_auto_3.5rem_3.5rem] gap-3 shadow-[inset_0_-1px_0_var(--rule)]"}>
      {asset.kind === "driver" ? <DriverPortrait driverId={asset.id} name={asset.name} teamColor={asset.teamColor} size={32} /> : <TeamLogo constructorId={asset.id} name={asset.name} color={asset.teamColor} size={30} />}
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui text-ink">
        {/* phones show a driver's code, wider screens the full name; never both */}
        {code ? <span className="timing text-ui font-[550] sm:hidden">{code}</span> : null}
        <span className={"min-w-0 truncate font-[550] " + (code ? "hidden sm:inline" : "")} title={asset.name}>
          {asset.name}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {isIn ? <Badge tone="up">In</Badge> : null}
        {boost ? (
          <Badge>
            <IconBoost size="0.75rem" /> {boost}
          </Badge>
        ) : null}
      </span>
      <span className="timing text-end text-table text-ink-2">{formatMoney(asset.price)}</span>
      <span className="timing text-end text-table text-ink">{asset.expectedPoints.toFixed(1)}</span>
    </li>
  );
}

function TransferRow({ transfer, label, assetById, windowRaces }: { transfer: TransferExplanation; label: (id: string | null) => string; assetById: (id: string) => MarketAsset | undefined; windowRaces: number }) {
  const incoming = transfer.in ? assetById(transfer.in) : undefined;
  const riseText = incoming ? `rise ${Math.round(incoming.pRise * 100)}%` : null;
  const priceText = formatMoneySigned(transfer.priceDelta);
  return (
    <li className="shadow-[inset_0_-1px_0_var(--rule)] last:shadow-none">
      <details className="group">
        <summary className={ROW + " press grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_4.5rem_4rem_1rem] gap-3 text-ui sm:grid-cols-[minmax(0,1fr)_4.5rem_4rem_4.5rem_1rem] [&::-webkit-details-marker]:hidden"}>
          <span className="min-w-0 font-[550] text-ink [overflow-wrap:anywhere]">
            {label(transfer.out)} → {label(transfer.in)}
          </span>
          <span className={"timing text-end " + (transfer.gainNow >= 0 ? "text-delta-up" : "text-delta-down")}>{formatSigned(transfer.gainNow, 1)}</span>
          <span className="timing text-end text-ink-2">{priceText}</span>
          <span className="timing hidden text-end text-caption text-ink-3 sm:inline">{riseText ?? ""}</span>
          <span className="text-end text-ink-3 transition-transform group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <dl className="timing grid grid-cols-3 gap-3 pb-3 text-caption">
          <MiniStat label={`${windowRaces} races`} value={`${formatSigned(transfer.gainWindow, 1)} pts`} />
          <MiniStat label="Floor (p10)" value={incoming ? formatSigned(incoming.p10, 1) : "n/a"} />
          <MiniStat label="Price outlook" value={incoming ? formatMoneySigned(incoming.expectedPriceChange, 2) : "n/a"} />
        </dl>
      </details>
    </li>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function ChipList({ rows }: { rows: ChipRow[] }) {
  if (rows.length === 0) return <p className={ROW + " border-t border-rule text-ui text-ink-3"}>No chips left.</p>;
  const columns = "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_4.25rem] gap-3 sm:grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_5.5rem_4.25rem]";
  return (
    <div className="text-ui">
      <div className={columns + " border-t border-rule py-1.5 text-caption text-ink-3"}>
        <span>Chip</span>
        <span className="text-end">Now</span>
        <span className="text-end">Later</span>
        <span className="hidden sm:inline">Where</span>
        <span>Advice</span>
      </div>
      <ul className="border-t border-rule">
        {rows.map((row) => (
          <li key={row.chip} className={ROW + " " + columns + " shadow-[inset_0_-1px_0_var(--rule)] last:shadow-none " + (row.advice === "used" ? "text-ink-3" : "")} title={[row.laterWhere, row.note].filter(Boolean).join(" · ") || undefined}>
            <span className="min-w-0 truncate text-ink">{row.name}</span>
            <span className="timing text-end">{row.now === null ? "" : formatSigned(row.now, 1)}</span>
            <span className="timing text-end">{row.later === null ? "" : formatSigned(row.later, 1)}</span>
            <span className="timing hidden truncate text-caption text-ink-3 sm:inline">{row.laterWhere ?? ""}</span>
            <span>
              <AdviceBadge advice={row.advice} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdviceBadge({ advice }: { advice: ChipRow["advice"] }) {
  if (advice === "play") return <Badge tone="up">Play</Badge>;
  if (advice === "hold") return <Badge>Hold</Badge>;
  if (advice === "locked") return <Badge>Locked</Badge>;
  return <span className="text-caption">Used</span>;
}

function Badge({ children, tone }: { children: ReactNode; tone?: "up" }) {
  const toneClass = tone === "up" ? "border-[var(--delta-up)] text-delta-up" : "border-rule text-ink";
  return <span className={"inline-flex items-center gap-1 rounded-chip border px-1.5 text-caption font-[600] uppercase tracking-wide " + toneClass}>{children}</span>;
}

function boostText(best: TeamResult, label: (id: string | null) => string): string | null {
  if (best.chip === "autopilot") return "Autopilot moves the x2 to your top scorer";
  if (best.extraBoost) return `x3 ${label(best.extraBoost)}${best.boost ? `, x2 ${label(best.boost)}` : ""}`;
  if (best.boost) return `x2 ${label(best.boost)}`;
  return null;
}

function toneOf(n: number): "up" | "down" | undefined {
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return undefined;
}

function roundInfos(market: Market): RoundInfo[] {
  const now = { round: market.round, raceName: market.raceName, hasSprint: market.hasSprint };
  const later = market.horizon.map((h) => ({ round: h.round, raceName: h.raceName, hasSprint: h.hasSprint }));
  return [now, ...later];
}

/** Sum of the expected points of the given assets (expected points before boosts). */
function sumPoints(ids: string[], market: Market): number {
  let total = 0;
  for (const id of ids) {
    const index = market.byId.get(id);
    if (index !== undefined) total += market.assets[index].expectedPoints;
  }
  return total;
}
