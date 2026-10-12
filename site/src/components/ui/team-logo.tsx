import Image from "next/image";
import images from "@/lib/data/fixtures/images.json";

interface LogoVariant {
  from: number | null;
  to: number | null;
  colour: string;
  white: string | null;
  /** Older artwork published on a light background: drawn on a small light plate. */
  plate?: boolean;
  /** Optical size correction for uneven padding in the artwork (build-logo-registry.mjs). */
  scale?: number;
  source: string;
}

interface TeamLogoProps {
  constructorId: string;
  name: string;
  color: string;
  size?: number;
  /** Season the logo should represent; picks the brand of that year. Defaults to the latest. */
  season?: number | null;
  className?: string;
}

const REGISTRY = (images as { teams?: Record<string, { variants: LogoVariant[] }> }).teams ?? {};

/**
 * Official team artwork, never recoloured, on a transparent background: the colour variant in
 * both themes. Brands whose colour artwork is a black mark carry a white variant, shown on the
 * dark theme instead. Only older artwork published on a light background (`plate`) sits on a
 * small light plate. Teams without official artwork get a monogram in the team colour.
 */
export function TeamLogo({ constructorId, name, color, size = 40, season = null, className = "" }: TeamLogoProps) {
  const variant = pickVariant(constructorId, season);
  const box = { width: size, height: size };
  if (!variant) {
    return <Monogram name={name} color={color} size={size} className={className} />;
  }
  const imgClass = "relative h-[84%] w-[84%] object-contain";
  // a transform, so the box and everything aligned to it stay put
  const fit = variant.scale && variant.scale !== 1 ? { transform: `scale(${variant.scale})` } : undefined;
  return (
    <span className={"team-logo relative inline-flex shrink-0 items-center justify-center " + className} style={box} title={name}>
      {variant.white ? (
        <>
          <Image src={variant.colour} alt={`${name} logo`} width={size} height={size} unoptimized loading="eager" className={imgClass + " dark:hidden"} style={fit} />
          <Image src={variant.white} alt="" aria-hidden width={size} height={size} unoptimized loading="eager" className={imgClass + " hidden dark:block"} style={fit} />
        </>
      ) : !variant.plate ? (
        <Image src={variant.colour} alt={`${name} logo`} width={size} height={size} unoptimized loading="eager" className={imgClass} style={fit} />
      ) : (
        <>
          <span aria-hidden="true" className="absolute inset-[4%] rounded-control bg-white shadow-[0_0_0_1px_var(--rule)]" />
          <Image src={variant.colour} alt={`${name} logo`} width={size} height={size} unoptimized loading="eager" className="relative h-[72%] w-[72%] object-contain" />
        </>
      )}
    </span>
  );
}

/** Team-colour monogram for constructors without official artwork. */
export function Monogram({ name, color, size, className = "" }: { name: string; color: string; size: number; className?: string }) {
  const letters = initials(name);
  return (
    <span
      className={"team-logo relative inline-flex shrink-0 items-center justify-center rounded-control " + className}
      style={{ width: size, height: size, background: color, color: inkOn(color) }}
      role="img"
      aria-label={`${name} monogram`}
      title={name}
    >
      <span className="headline" style={{ fontSize: size * (letters.length > 1 ? 0.36 : 0.46), letterSpacing: "-0.02em", lineHeight: 1 }}>
        {letters}
      </span>
    </span>
  );
}

export function hasTeamLogo(constructorId: string, season: number | null = null): boolean {
  return pickVariant(constructorId, season) !== null;
}

function pickVariant(constructorId: string, season: number | null): LogoVariant | null {
  const entry = REGISTRY[constructorId];
  if (!entry) return null;
  if (season === null) return entry.variants[0] ?? null;
  for (const v of entry.variants) {
    const fromOk = v.from === null || season >= v.from;
    const toOk = v.to === null || season <= v.to;
    if (fromOk && toOk) return v;
  }
  return null;
}

function initials(name: string): string {
  const words = name
    .replace(/\b(F1|Team|Racing|Grand Prix|Motorsport|Formula)\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Black or white text for a hex team colour, by relative luminance. */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#fff";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#111" : "#fff";
}
