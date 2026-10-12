import type { ReactNode } from "react";
import type { IconComponent } from "@/components/icons";
import { Info } from "./info";

interface SectionProps {
  title: string;
  icon?: IconComponent;
  info?: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  flush?: boolean;
  /** Smaller top margin, for the first section right after the page intro. */
  tight?: boolean;
}

/**
 * Page section. Site-wide heading system: a short all-caps title with one icon on a hairline;
 * any explanation lives behind the info icon, never as a subtitle. `aside` sits on the right.
 */
export function Section({ title, icon: Icon, info, aside, children, id, flush, tight }: SectionProps) {
  const spacing = tight ? "mt-4 sm:mt-6" : "mt-10 sm:mt-14";
  return (
    <section id={id} className={"stagger-in mx-auto w-full max-w-[1440px] px-4 sm:px-6 " + spacing}>
      <div className="hairline-y flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-3">
        <h2 className="section-title flex items-center gap-2">
          {Icon ? <Icon size="1.125rem" className="text-ink-2" /> : null}
          <span>{title}</span>
          {info ? <Info text={info} /> : null}
        </h2>
        {aside ? <div className="text-ui text-ink-2">{aside}</div> : null}
      </div>
      <div className={flush ? "mt-3" : "mt-5"}>{children}</div>
    </section>
  );
}

/** Same heading, for use inside custom layouts (grids, panels). */
export function SectionTitle({ title, icon: Icon, info, aside }: Omit<SectionProps, "children" | "id" | "flush">) {
  return (
    <div className="hairline-y flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-3">
      <h2 className="section-title flex items-center gap-2">
        {Icon ? <Icon size="1.125rem" className="text-ink-2" /> : null}
        <span>{title}</span>
        {info ? <Info text={info} /> : null}
      </h2>
      {aside ? <div className="text-ui text-ink-2">{aside}</div> : null}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={"mx-auto max-w-[1440px] px-4 sm:px-6 " + className}>{children}</div>;
}
