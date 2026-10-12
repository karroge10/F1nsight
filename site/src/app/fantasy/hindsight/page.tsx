import type { Metadata } from "next";
import Link from "next/link";
import { getCalendar, getEntryList, getFantasyRounds } from "@/lib/data";
import { hindsightInputs } from "@/lib/fantasy/hindsight";
import { PageIntro } from "@/components/ui/page-intro";
import { HindsightView, type HindsightLabels } from "@/components/fantasy/hindsight-view";
import { IconWarning } from "@/components/icons";

export const metadata: Metadata = {
  title: "Fantasy hindsight",
  description: "The best F1 Fantasy team of every 2026 round on real points: with no budget and within your budget, x2 Boost included.",
};

export default async function HindsightPage() {
  const rounds = await getFantasyRounds();
  if (!rounds) return <MissingData />;
  const entries = await getEntryList(rounds.season);
  const calendar = await getCalendar(rounds.season);
  const raceNames = Object.fromEntries(calendar.map((race) => [race.round, race.raceName]));
  const inputs = hindsightInputs(rounds, raceNames);
  const labels = buildLabels(entries);

  return (
    <>
      <PageIntro
        compact
        label={
          <>
            <Link href="/fantasy" className="hover:text-ink">Fantasy</Link> <span className="mx-1.5 text-ink-3">/</span> Hindsight
          </>
        }
        title={`${rounds.season} best teams in hindsight`}
        dek="Each round's top team on real points, with no budget and within yours."
      />
      <HindsightView inputs={inputs} labels={labels} />
    </>
  );
}

function MissingData() {
  return (
    <PageIntro
      compact
      label={
        <span className="inline-flex items-center gap-2">
          <IconWarning size="1rem" /> Fantasy hindsight
        </span>
      }
      title="Round data not exported yet"
      dek="Run uv run python -m f1p.fantasy.serve_rounds in v2/pipeline to write data/serve/fantasy_rounds.json, then reload."
    />
  );
}

function buildLabels(entries: Awaited<ReturnType<typeof getEntryList>>): HindsightLabels {
  const labels: HindsightLabels = { codes: {}, names: {}, colors: {} };
  const teams: NonNullable<HindsightLabels["teams"]> = {};
  for (const d of entries.drivers) {
    labels.codes[d.driverId] = d.code;
    labels.names[d.driverId] = d.name;
    labels.colors[d.driverId] = d.teamColor;
    teams[d.driverId] = { constructorId: d.constructorId, name: d.team };
  }
  for (const c of entries.constructors) {
    labels.names[c.constructorId] = c.name;
    labels.codes[c.constructorId] = c.name.slice(0, 3).toUpperCase();
    labels.colors[c.constructorId] = c.color;
    teams[c.constructorId] = { constructorId: c.constructorId, name: c.name };
  }
  labels.teams = teams;
  return labels;
}
