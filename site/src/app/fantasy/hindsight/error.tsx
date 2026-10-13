"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { IconWarning } from "@/components/icons";

export default function HindsightError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageIntro
        label={
          <span className="inline-flex items-center gap-2">
            <IconWarning size="1rem" /> Fantasy hindsight
          </span>
        }
        title="Hindsight teams could not load"
        dek="The round data did not respond. Try again, or go back to the fantasy planner."
      />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <button type="button" onClick={retry} className="press selected-pill inline-flex h-11 items-center rounded-control px-5 text-ui font-[550]">
          Try again
        </button>
      </div>
    </>
  );
}
