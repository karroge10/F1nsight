import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { NavLinks } from "./nav-links";
import { Wordmark } from "./wordmark";

export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      {/* Phones: logo and theme toggle on the first row, the nav as its own full-width scrolling
          row below, so no link is ever cut by the logo. From sm up it is one row. */}
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 px-4 sm:h-14 sm:flex-nowrap sm:px-6">
        <Link href="/" className="flex min-h-11 shrink-0 items-center text-[1.125rem]" aria-label="F1nsight home">
          <Wordmark />
        </Link>
        <div className="ml-auto flex h-14 shrink-0 items-center gap-2 sm:order-last sm:h-auto">
          <ThemeToggle />
        </div>
        <NavLinks />
      </div>
    </header>
  );
}
