"use client";

import { PageIntro } from "@/components/ui/page-intro";

export default function TelemetryError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageIntro
        title="Telemetry could not load"
        dek="The lap data did not respond or could not be read. Try again, or pick another session."
      />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <button type="button" onClick={retry} className="press selected-pill inline-flex h-11 items-center rounded-control px-5 text-ui font-[550]">
          Try again
        </button>
      </div>
    </>
  );
}
