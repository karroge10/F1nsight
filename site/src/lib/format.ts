// Formatting helpers for timing data. Pure functions, safe on server and client.

export function formatLapTime(ms: number | null | undefined, options: { blankZero?: boolean } = {}): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "";
  if (ms === 0 && options.blankZero) return "";
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  const secondsText = seconds.toFixed(3).padStart(6, "0");
  if (minutes === 0) return seconds.toFixed(3);
  return `${minutes}:${secondsText}`;
}

export function formatRaceTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const hours = Math.floor(ms / 3600000);
  const rest = ms - hours * 3600000;
  const minutes = Math.floor(rest / 60000);
  const seconds = (rest - minutes * 60000) / 1000;
  const secondsText = seconds.toFixed(3).padStart(6, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${secondsText}`;
  return `${minutes}:${secondsText}`;
}

export function formatGap(ms: number | null | undefined, options: { plus?: boolean } = { plus: true }): string {
  if (ms === null || ms === undefined) return "";
  const sign = options.plus && ms >= 0 ? "+" : "";
  if (Math.abs(ms) >= 60000) {
    const minutes = Math.floor(Math.abs(ms) / 60000);
    const seconds = (Math.abs(ms) - minutes * 60000) / 1000;
    return `${sign}${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
  }
  return `${sign}${(ms / 1000).toFixed(3)}`;
}

/**
 * Probability as a percentage. A model forecast is never certain, so values that would round
 * to 0% or 100%, including an exact 0 or 1 from a simulation where the event never or always
 * happened, are shown as "<1%" / ">99%" (or "<0.1%" / ">99.9%" with one decimal).
 */
export function formatPercent(p: number, digits = 0): string {
  const value = p * 100;
  const step = Math.pow(10, -digits);
  const floor = step / 2;
  const unit = digits === 0 ? "1" : step.toFixed(digits);
  if (value < floor) return `<${unit}%`;
  if (value > 100 - floor) return `>${(100 - step).toFixed(digits)}%`;
  return `${value.toFixed(digits)}%`;
}

export function formatPoints(points: number): string {
  if (Number.isInteger(points)) return String(points);
  return points.toFixed(1);
}

export function formatSigned(value: number, digits = 1): string {
  if (value === 0) return "0";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

/** Money in millions with the dollar sign, e.g. "$27.0M". */
export function formatMoney(value: number, digits = 1): string {
  return `$${value.toFixed(digits)}M`;
}

/** Signed money change, e.g. "+$0.3M" or "−$1.6M" (a real minus sign); zero has no sign. */
export function formatMoneySigned(value: number, digits = 1): string {
  const magnitude = Math.abs(value).toFixed(digits);
  if (Number(magnitude) === 0) return `$${magnitude}M`;
  const sign = value > 0 ? "+" : "−";
  return `${sign}$${magnitude}M`;
}

export function formatDate(iso: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const date = new Date(iso);
  const dateOptions = { ...options, timeZone: "UTC" };
  return formatEnGB(date, dateOptions);
}

export function formatDateTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  };
  return formatEnGB(date, dateTimeOptions);
}

export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function positionLabel(positionText: string): string {
  switch (positionText) {
    case "R":
      return "DNF";
    case "D":
      return "DSQ";
    case "W":
      return "DNS";
    case "F":
      return "DNQ";
    case "N":
      return "NC";
    case "E":
      return "EX";
    default:
      return positionText;
  }
}

export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// en-GB prints the short month for September as "Sept" on newer ICU data; the site uses "Sep" everywhere
function formatEnGB(date: Date, options: Intl.DateTimeFormatOptions): string {
  const parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(date);
  return parts.map(shortSeptember).join("");
}

function shortSeptember(part: Intl.DateTimeFormatPart): string {
  return part.type === "month" && part.value === "Sept" ? "Sep" : part.value;
}
