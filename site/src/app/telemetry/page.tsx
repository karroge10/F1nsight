import type { Metadata } from "next";
import { getSessionTelemetry, getTelemetryIndex } from "@/lib/data";
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
  return <TelemetryPageBody initial={session} index={index} />;
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
      dek="No telemetry exported yet. Run uv run python -m f1p.fastf1.telemetry_export in v2/pipeline (it reads the local FastF1 cache), then rebuild."
    />
  );
}
