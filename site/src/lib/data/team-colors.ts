// Team colours used as data (map dots, chart lines, name rules). The 2026 grid is pinned so
// the forecast, fantasy and stats pages agree; older teams fall back to the database value.

export const TEAM_COLORS: Record<string, string> = {
  mercedes: "#27F4D2",
  ferrari: "#E8002D",
  mclaren: "#FF8000",
  red_bull: "#3671C6",
  rb: "#6692FF",
  alpine: "#FF87BC",
  haas: "#B6BABD",
  audi: "#FF2D00",
  cadillac: "#C8A24A",
  williams: "#64C4FF",
  aston_martin: "#229971",
  sauber: "#52E252",
  alphatauri: "#5E8FAA",
  alfa: "#C92D4B",
  racing_point: "#F596C8",
  renault: "#FFF500",
  toro_rosso: "#469BFF",
  force_india: "#F596C8",
  lotus_f1: "#FFB800",
  brawn: "#B9F321",
  bmw_sauber: "#1F3FBF",
  toyota: "#CC0000",
  honda: "#CFCFCF",
  jaguar: "#0A5F38",
  jordan: "#F2C800",
  benetton: "#2BBF9B",
  tyrrell: "#1F4FBF",
  brabham: "#2E6B4F",
  lotus: "#1C6B3A",
  cooper: "#2A5A2A",
  maserati: "#C00000",
  vanwall: "#1F6B3A",
  matra: "#1F4FBF",
  ligier: "#2D6BD6",
  arrows: "#F08A1D",
};

export const FALLBACK_TEAM_COLOR = "#8A8F98";

export function teamColor(constructorId: string, fromData?: string | null): string {
  return TEAM_COLORS[constructorId] ?? fromData ?? FALLBACK_TEAM_COLOR;
}
