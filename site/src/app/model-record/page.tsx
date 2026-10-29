import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/ui/page-intro";

export const metadata: Metadata = { title: "Model predictions" };

export default function ModelRecordPage() {
  return (
    <>
      <PageIntro
        label="Forecasts"
        title="Predictions now live in Races"
        dek="Race winner calls and driver finishing-position comparisons are shown alongside each race in the calendar and race details."
        extra={<Link href="/races" className="press inline-flex h-10 items-center rounded-control bg-ink px-4 text-ui font-[600] text-bg hover:opacity-90">Go to Races</Link>}
      />
      <p className="mx-auto max-w-[1440px] px-4 pb-10 text-caption text-ink-3 sm:px-6">Saved historical predictions are labeled as retrospective backtests. A replay does not verify that a forecast was published before the race.</p>
    </>
  );
}
