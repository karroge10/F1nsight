import Image from "next/image";
import images from "@/lib/data/fixtures/images.json";

interface DriverPortraitProps {
  driverId: string;
  name: string;
  teamColor: string;
  size?: number;
  className?: string;
}

const PORTRAITS = images.drivers as Record<string, { src: string; width: number; height: number }>;

/**
 * Borderless headshot. The F1 headshots are transparent cutouts, so the photo sits on a soft
 * radial team-colour wash that fades to nothing, and the image itself fades into the page at
 * the bottom. No box, no stroke. Falls back to initials on the same wash, same footprint.
 */
export function DriverPortrait({ driverId, name, teamColor, size = 64, className = "" }: DriverPortraitProps) {
  const portrait = PORTRAITS[driverId];
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  // the wash ends well inside the box on every side, so it never meets an edge
  const wash = `radial-gradient(circle closest-side at 50% 55%, color-mix(in oklab, ${teamColor} 30%, transparent) 0%, color-mix(in oklab, ${teamColor} 10%, transparent) 60%, transparent 100%)`;
  return (
    <span className={"relative inline-flex shrink-0 items-end justify-center " + className} style={{ width: size, height: size }} aria-hidden={portrait ? undefined : true}>
      <span aria-hidden="true" className="absolute inset-0" style={{ background: wash }} />
      {portrait ? (
        <Image
          src={portrait.src}
          alt={name}
          width={size}
          height={size}
          sizes={`${size}px`}
          // the 2026 headshots are 320px square webp files (about 15 to 25 KB), already sharp at 3x
          // for every size used; the optimizer picked 1x files and blurred them on phones
          unoptimized
          className="relative h-full w-full object-cover object-top"
          style={{ maskImage: "linear-gradient(to bottom, #000 60%, transparent 98%)", WebkitMaskImage: "linear-gradient(to bottom, #000 60%, transparent 98%)" }}
          priority={size >= 96}
          loading={size >= 96 ? undefined : "eager"}
        />
      ) : (
        <span className="headline relative pb-[14%] text-ink-2" style={{ fontSize: size * 0.34 }}>
          {initials}
        </span>
      )}
    </span>
  );
}

export function hasPortrait(driverId: string): boolean {
  return Boolean(PORTRAITS[driverId]);
}
