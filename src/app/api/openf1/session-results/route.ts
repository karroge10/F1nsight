import { NextResponse } from "next/server";

export const revalidate = 1800;
const OPENF1 = "https://api.openf1.org/v1";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const session_key = searchParams.get("session_key");
    const limit = parseInt(searchParams.get("limit") || "3");

    if (!session_key) {
      return NextResponse.json({ error: "session_key required" }, { status: 400 });
    }

    const res = await fetch(`${OPENF1}/session_result?session_key=${session_key}`, { next: { revalidate } });
    if (!res.ok) throw new Error(`OpenF1 session_result failed: ${res.status}`);
    const raw = await res.json();

    const top = Array.isArray(raw)
      ? raw
          .filter((r: any) => r.position != null)
          .sort((a: any, b: any) => a.position - b.position)
          .slice(0, limit)
          .map((r: any) => ({
            position: r.position ?? null,
            driver: r.full_name || r.broadcast_name || r.name_acronym || `#${r.driver_number}`,
            team: r.team_name || "Unknown",
            points: r.points ?? 0,
            status: r.status || undefined,
          }))
      : [];

    return NextResponse.json({ data: { top, source: "openf1" }, success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error)?.message ?? "unknown" }, { status: 500 });
  }
}
