/** Loading placeholders with the final dimensions of the content they stand in for. */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={"skeleton rounded-control " + className} />;
}

export function SkeletonIntro({ compact = false }: { compact?: boolean }) {
  return (
    <div className={"mx-auto max-w-[1440px] px-4 sm:px-6 " + (compact ? "pt-6 pb-4" : "pt-8 pb-6 sm:pt-12 sm:pb-8")}>
      <SkeletonBlock className="h-5 w-40" />
      <SkeletonBlock className={"mt-3 " + (compact ? "h-8 w-80" : "h-12 w-[28rem] max-w-full")} />
      <SkeletonBlock className="mt-4 h-5 w-full max-w-2xl" />
    </div>
  );
}

export function SkeletonTable({ rows = 12, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={"mx-auto max-w-[1440px] px-4 sm:px-6 " + className} aria-busy="true" aria-label="Loading">
      <div className="hairline-y pt-4">
        <SkeletonBlock className="h-7 w-72" />
        <SkeletonBlock className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mt-4">
        <div className="h-8 border-b border-rule-strong" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-9 items-center gap-4 border-b border-rule">
            <SkeletonBlock className="h-3 w-6" />
            <SkeletonBlock className="h-3 w-40" />
            <SkeletonBlock className="hidden h-3 w-24 sm:block" />
            <SkeletonBlock className="ml-auto h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
