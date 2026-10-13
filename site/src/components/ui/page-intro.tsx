import type { ReactNode } from "react";

interface PageIntroProps {
  label?: ReactNode;
  title: ReactNode;
  dek?: ReactNode;
  aside?: ReactNode;
  /** Below the dek in the left column (navigation, actions). */
  extra?: ReactNode;
}

export function PageIntro({ label, title, dek, aside, extra }: PageIntroProps) {
  return (
    <div className="page-intro stagger-in mx-auto max-w-[1440px] px-4 pt-8 pb-6 sm:px-6 sm:pt-12 sm:pb-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {label ? <p className="eyebrow mb-3">{label}</p> : null}
          <h1 className="headline text-h1 text-ink">{title}</h1>
          {dek ? <p className="mt-3 max-w-2xl text-body text-ink-2">{dek}</p> : null}
          {extra ? <div className="mt-5">{extra}</div> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
    </div>
  );
}
