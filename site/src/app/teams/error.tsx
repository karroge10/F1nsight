"use client";

import { PageIntro } from "@/components/ui/page-intro";

export default function TeamsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageIntro
        title="Teams could not load"
        dek="The constructor data did not respond. Try again, or open another page from the navigation."
      />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <button type="button" onClick={retry} className="press selected-pill inline-flex h-11 items-center rounded-control px-5 text-ui font-[550]">
          Try again
        </button>
      </div>
    </>
  );
}
