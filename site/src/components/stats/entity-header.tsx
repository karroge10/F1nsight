import type { ReactNode } from "react";
import { Figure } from "@/components/ui/figure";

interface EntityHeaderProps {
  label: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  color?: string;
  media?: ReactNode;
  figures: { label: string; value: ReactNode; note?: ReactNode }[];
}

/** Page header for a driver, team or circuit: label, big name with team rule, meta line, stat tiles. */
export function EntityHeader({ label, title, meta, color, media, figures }: EntityHeaderProps) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="flex items-start gap-5 lg:col-span-5">
          {media ? <div className="shrink-0">{media}</div> : null}
          <div className="min-w-0">
            <p className="eyebrow mb-3">{label}</p>
            <h1 className="headline flex items-start gap-3 text-h1 text-ink">
              {color && !media ? <span aria-hidden="true" className="mt-2 inline-block h-[0.8em] w-1 shrink-0 rounded-chip" style={{ background: color }} /> : null}
              <span>{title}</span>
            </h1>
            {meta ? <p className="mt-3 text-body text-ink-2">{meta}</p> : null}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-6 lg:col-span-7 sm:grid-cols-4 lg:grid-cols-5 lg:self-end">
          {figures.map((f) => (
            <Figure key={f.label} label={f.label} value={f.value} note={f.note} />
          ))}
        </div>
      </div>
    </div>
  );
}
