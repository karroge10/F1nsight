export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-6 text-caption text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Results and history from the Jolpica F1 database. Fantasy prices from the official F1 Fantasy game. Forecasts are model output, not advice.</p>
        <p className="tnum">F1nsight is a personal project, not affiliated with Formula 1. Everything here is free.</p>
      </div>
    </footer>
  );
}
