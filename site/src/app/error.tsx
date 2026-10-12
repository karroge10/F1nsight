"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageIntro } from "@/components/ui/page-intro";
import { IconWarning } from "@/components/icons";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageIntro
        label={
          <span className="inline-flex items-center gap-2">
            <IconWarning size="1rem" /> Error
          </span>
        }
        title="Something went wrong"
        dek={
          <>
            The page did not load. Retry, or head back to the{" "}
            <Link href="/" className="text-ink underline underline-offset-2">forecast</Link>.
          </>
        }
      />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <button
          type="button"
          onClick={() => retry()}
          className="press inline-flex h-10 items-center rounded-control border border-rule-strong px-4 text-ui text-ink hover:bg-bg-hover"
        >
          Try again
        </button>
      </div>
    </>
  );
}
