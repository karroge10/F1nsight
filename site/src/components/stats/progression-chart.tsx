import type { Lookups, RaceSummary, StandingsTable } from "@/lib/data";
import { LineChart, type LineSeries } from "@/components/charts/line-chart";

interface ProgressionChartProps {
  table: StandingsTable;
  races: RaceSummary[];
  lookups: Lookups;
  kind: "drivers" | "constructors";
  emphasise?: number;
  title: string;
}

/** Cumulative points after each round. Top entries emphasised, the rest muted, colour by team. */
export function ProgressionChart({ table, races, lookups, kind, emphasise = 6, title }: ProgressionChartProps) {
  const rounds = table.rounds;
  const xLabels = races.filter((r) => r.round <= rounds).map((r) => shortName(r.raceName));
  const series: LineSeries[] = table.list.slice(0, Math.max(emphasise, 10)).map((row, i) => {
    const teamId = kind === "drivers" ? row.constructorIds?.[row.constructorIds.length - 1] ?? "" : row.id;
    const label = kind === "drivers" ? lookups.driverCode(row.id) : shortTeam(lookups.teamName(row.id));
    return {
      id: row.id,
      label,
      color: lookups.teamColor(teamId),
      values: row.pointsByRound.slice(0, rounds),
      emphasis: i < emphasise,
    };
  });
  return <LineChart series={series} xLabels={xLabels} yLabel="points" title={title} maxLabels={emphasise} />;
}

function shortTeam(name: string) {
  return name.replace(/ F1 Team$/i, "").replace(/ Racing$/i, "").replace(/^Scuderia /i, "").slice(0, 14);
}

function shortName(raceName: string) {
  const name = raceName.replace(" Grand Prix", "").replace("Grand Prix", "").trim();
  const map: Record<string, string> = {
    Australian: "AUS",
    Chinese: "CHN",
    Japanese: "JPN",
    Bahrain: "BHR",
    "Saudi Arabian": "SAU",
    Miami: "MIA",
    "Emilia Romagna": "EMI",
    Monaco: "MON",
    Canadian: "CAN",
    Spanish: "ESP",
    Barcelona: "BCN",
    Austrian: "AUT",
    British: "GBR",
    Belgian: "BEL",
    Hungarian: "HUN",
    Dutch: "NED",
    Italian: "ITA",
    Azerbaijan: "AZE",
    Singapore: "SGP",
    "United States": "USA",
    "Mexico City": "MEX",
    Mexican: "MEX",
    Brazilian: "BRA",
    "São Paulo": "BRA",
    "Las Vegas": "LAS",
    Qatar: "QAT",
    "Abu Dhabi": "ABU",
    "Bahrain in Malaysia": "MYS",
  };
  return map[name] ?? name.slice(0, 3).toUpperCase();
}
