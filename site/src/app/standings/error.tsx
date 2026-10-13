"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { IconDnf } from "@/components/icons";

export default function StandingsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageIntro
        label={
          <span className="inline-flex items-center gap-2">
            <IconDnf size="1rem" /> Standings
          </span>
        }
        title="Standings could not load"
        dek="The season data did not respond. Try again, or open another season from the picker."
      />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <button type="button" onClick={retry} className="press selected-pill inline-flex h-11 items-center rounded-control px-5 text-ui font-[550]">
          Try again
        </button>
      </div>
    </>
  );
}
