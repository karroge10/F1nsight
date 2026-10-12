// Motorsport icons drawn to match Phosphor duotone: 256 unit grid, 16 unit round strokes, a
// filled secondary layer at 20% opacity. All use currentColor unless the mark itself carries a
// semantic colour (tyre compounds, flags).

import type { SVGProps } from "react";

interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number | string;
  label?: string;
}

function Mark({ size = "1em", label, children, ...rest }: MarkProps & { children: React.ReactNode }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 256 256" fill="currentColor" {...a11y} {...rest}>
      {children}
    </svg>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 16, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function IconChequered(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M56 40h152v128H56z" opacity={0.2} />
      <path d="M56 40v192M56 40h152v128H56" {...stroke} />
      <path d="M94 40v128M132 40v128M170 40v128M56 72h152M56 104h152M56 136h152" stroke="currentColor" strokeWidth={8} fill="none" />
      <path d="M56 40h38v32H56zM132 40h38v32h-38zM94 72h38v32H94zM170 72h38v32h-38zM56 104h38v32H56zM132 104h38v32h-38zM94 136h38v32H94zM170 136h38v32h-38z" />
    </Mark>
  );
}

export function IconFlag({ color, ...props }: MarkProps & { color?: string }) {
  return (
    <Mark {...props}>
      <path d="M56 48h144l-24 48 24 48H56z" fill={color ?? "currentColor"} opacity={color ? 0.9 : 0.2} />
      <path d="M56 224V48h144l-24 48 24 48H56" {...stroke} />
    </Mark>
  );
}

export function IconPitBox(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M40 104h176v96H40z" opacity={0.2} />
      <path d="M40 200V104l88-56 88 56v96M40 200h176" {...stroke} />
      <path d="M96 200v-56h64v56" {...stroke} />
      <path d="M112 128h32" {...stroke} />
    </Mark>
  );
}

export function IconSafetyCar(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M40 136l24-56h128l24 56v48H40z" opacity={0.2} />
      <path d="M40 136l24-56h128l24 56v48H40zM40 136h176M72 184v24M184 184v24" {...stroke} />
      <circle cx={84} cy={160} r={10} />
      <circle cx={172} cy={160} r={10} />
      <path d="M104 80V56h48v24" {...stroke} />
      <path d="M112 56h32" stroke="currentColor" strokeWidth={16} strokeLinecap="round" fill="none" />
    </Mark>
  );
}

export function IconVsc(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M40 136l24-56h128l24 56v48H40z" opacity={0.2} />
      <path d="M40 136l24-56h128l24 56v48H40zM40 136h176" {...stroke} strokeDasharray="20 14" />
      <circle cx={84} cy={160} r={10} />
      <circle cx={172} cy={160} r={10} />
    </Mark>
  );
}

export function IconFastestLap(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx={128} cy={144} r={80} opacity={0.2} />
      <circle cx={128} cy={144} r={80} {...stroke} />
      <path d="M104 32h48M128 32v32" {...stroke} />
      <path d="M140 104l-28 48h32l-12 40 36-56h-32l16-32z" />
    </Mark>
  );
}

export function IconOvertake(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M48 176h88l32-40 40 48" opacity={0.2} />
      <path d="M48 176h88l32-40 40 48" {...stroke} />
      <path d="M48 88h72l24 32" {...stroke} opacity={0.6} />
      <path d="M176 152l32 32-32 32" {...stroke} />
    </Mark>
  );
}

export function IconDnf(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M40 144l24-48h128l24 48v40H40z" opacity={0.2} />
      <path d="M40 144l24-48h128l24 48v40H40zM40 144h176" {...stroke} />
      <path d="M160 48l48 48M208 48l-48 48" {...stroke} />
      <circle cx={84} cy={164} r={10} />
      <circle cx={172} cy={164} r={10} />
    </Mark>
  );
}

export function IconGridSlot(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M72 72h112v112H72z" opacity={0.2} />
      <path d="M40 72h32v112H40M216 72h-32v112h32" {...stroke} />
      <path d="M72 72h112v112H72z" {...stroke} />
    </Mark>
  );
}

export function IconHelmet(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M40 136a88 88 0 0 1 176 0v48H40z" opacity={0.2} />
      <path d="M40 136a88 88 0 0 1 176 0v48H40z" {...stroke} />
      <path d="M40 136h88l24 32h64" {...stroke} />
      <path d="M40 184v24h176v-24" {...stroke} />
    </Mark>
  );
}

export function IconSprint(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M144 32L64 144h56l-16 80 88-120h-56z" opacity={0.2} />
      <path d="M144 32L64 144h56l-16 80 88-120h-56z" {...stroke} />
    </Mark>
  );
}

export function IconTrackTemp(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M40 200h176l-24-72H64z" opacity={0.2} />
      <path d="M40 200h176l-24-72H64zM128 128v72" {...stroke} strokeDasharray="24 16" />
      <path d="M96 88c0-32 16-56 32-56s32 24 32 56" {...stroke} />
      <path d="M112 72c8-8 24-8 32 0" {...stroke} />
    </Mark>
  );
}

export function IconRainDrop(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M128 32s-64 72-64 120a64 64 0 0 0 128 0c0-48-64-120-64-120z" opacity={0.2} />
      <path d="M128 32s-64 72-64 120a64 64 0 0 0 128 0c0-48-64-120-64-120z" {...stroke} />
      <path d="M96 160a32 32 0 0 0 24 28" {...stroke} />
    </Mark>
  );
}

export function IconWindArrow(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M32 112h128a24 24 0 1 0-24-24M32 152h160a24 24 0 1 1-24 24M32 72h64" {...stroke} />
      <path d="M160 88a24 24 0 1 1 0 48" opacity={0.2} />
    </Mark>
  );
}

export function IconChip(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x={64} y={64} width={128} height={128} rx={16} opacity={0.2} />
      <rect x={64} y={64} width={128} height={128} rx={16} {...stroke} />
      <path d="M104 32v32M152 32v32M104 192v32M152 192v32M32 104h32M32 152h32M192 104h32M192 152h32" {...stroke} />
      <rect x={104} y={104} width={48} height={48} rx={6} />
    </Mark>
  );
}

const COMPOUND_COLOR: Record<string, string> = {
  S: "var(--tyre-soft)",
  M: "var(--tyre-medium)",
  H: "var(--tyre-hard)",
  I: "var(--tyre-inter)",
  W: "var(--tyre-wet)",
};

const COMPOUND_NAME: Record<string, string> = { S: "soft", M: "medium", H: "hard", I: "intermediate", W: "wet" };

/** Tyre compound mark: ring in the compound colour with the letter inside. */
export function IconTyre({ compound, size = "1.125em", ...props }: MarkProps & { compound: string }) {
  const color = COMPOUND_COLOR[compound] ?? "var(--rule-strong)";
  const label = props.label ?? `${COMPOUND_NAME[compound] ?? "unknown"} tyre`;
  return (
    <Mark size={size} {...props} label={label}>
      <circle cx={128} cy={128} r={104} fill={color} opacity={0.18} />
      <circle cx={128} cy={128} r={104} fill="none" stroke={color} strokeWidth={28} />
      <text x={128} y={128} textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-sans)" fontWeight={700} fontSize={110} fill="currentColor">
        {compound}
      </text>
    </Mark>
  );
}
