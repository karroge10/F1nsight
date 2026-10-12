import { formatMoneySigned, formatSigned } from "@/lib/format";

interface DeltaProps {
  value: number;
  digits?: number;
  suffix?: string;
  invert?: boolean;
  neutralBelow?: number;
  /** Show the value as money ("+$0.3M"). */
  money?: boolean;
}

/** Signed change. Colour follows direction times whether up is good. */
export function Delta({ value, digits = 1, suffix = "", invert = false, neutralBelow = 0, money = false }: DeltaProps) {
  const magnitude = Math.abs(value);
  const neutral = magnitude <= neutralBelow;
  const good = invert ? value < 0 : value > 0;
  const colorClass = neutral ? "text-ink-3" : good ? "text-delta-up" : "text-delta-down";
  const text = money ? formatMoneySigned(value, digits) : formatSigned(value, digits);
  return (
    <span className={"timing " + colorClass}>
      {text}
      {suffix}
    </span>
  );
}
