import { firstCountryIso2 } from "@/lib/countries";

interface FlagProps {
  /** Nationality ("British"), country name ("UK") or code ("GBR", "GB"). The first that resolves wins. */
  of: string | null | undefined;
  /** A second source tried when `of` does not resolve, usually the record's country code. */
  fallback?: string | null;
  /** Width in px; the flag is 3:2. */
  size?: number;
  /** Keep the slot empty when there is no flag, so stacked rows stay aligned. Default true. */
  keepSpace?: boolean;
  className?: string;
}

/**
 * A small 3:2 country flag from the bundled SVG set (public/flags), so it renders offline and on
 * Windows, which has no flag emoji. Decorative: the country is always written beside it.
 */
export function Flag({ of, fallback = null, size = 16, keepSpace = true, className = "" }: FlagProps) {
  const iso2 = firstCountryIso2(of, fallback);
  const height = Math.round((size * 2) / 3);
  const box = { width: size, height };
  if (!iso2) {
    if (!keepSpace) return null;
    return <span aria-hidden="true" className={"inline-block shrink-0 " + className} style={box} />;
  }
  const src = `/flags/${iso2.toLowerCase()}.svg`;
  return (
    // a plain img: the SVGs are tiny static files and need no optimizer
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" aria-hidden="true" width={size} height={height} loading="lazy" decoding="async" data-flag={iso2} className={"inline-block shrink-0 rounded-[2px] object-cover shadow-[0_0_0_1px_var(--rule)] " + className} style={box} />
  );
}
