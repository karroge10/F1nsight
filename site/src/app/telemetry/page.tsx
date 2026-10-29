import type { Metadata } from "next";
import { getCalendar, getCurrentSeason, getSessionTelemetry, getTelemetryIndex } from "@/lib/data";
import { PageIntro } from "@/components/ui/page-intro";
import { TelemetryPage as TelemetryPageBody } from "@/components/telemetry/telemetry-page";
import { IconWarning } from "@/components/icons";

export const metadata: Metadata = {
  title: "Telemetry comparison",
  description: "Compare two drivers' fastest laps: speed, throttle, brake and the running gap against distance, plus a track speed map. FastF1 data, 2018 to 2026.",
};

/** Prerendered with the newest session; `?s=2026-16-Q&a=RUS&b=ANT` loads another one in the browser. */
export default async function TelemetryPage() {
  const index = await getTelemetryIndex();
  const first = index[0] ?? null;
  const session = first ? await getSessionTelemetry(first) : null;
  if (!session) return <NoTelemetry />;
  const calendar = await getCalendar(await getCurrentSeason());
  const latest = [...calendar].filter((r) => !r.cancelled && r.status === "completed").sort((a, b) => b.round - a.round)[0];
  const notice = latest && (latest.season > session.season || latest.round > session.round) ? `${latest.raceName} telemetry is not available from the upstream feed yet.` : null;
  return <TelemetryPageBody initial={session} index={index} notice={notice} />;
}

function NoTelemetry() {
  return (
    <PageIntro
      label={
        <span className="inline-flex items-center gap-2">
          <IconWarning size="1rem" /> Telemetry
        </span>
      }
      title="Telemetry not available"
      dek="No telemetry exported yet. Run uv run python -m f1p.fastf1.telemetry_export in pipeline (it reads the local FastF1 cache), then rebuild."
    />
  );
}
