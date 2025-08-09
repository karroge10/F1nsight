import { NextResponse } from "next/server";

export const revalidate = 1800; // 30 minutes

const OPENF1 = "https://api.openf1.org/v1";

async function of1(path: string) {
  const res = await fetch(`${OPENF1}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`OpenF1 ${path} failed: ${res.status}`);
  return res.json();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year") || `${new Date().getFullYear()}`);

    // Get all Race sessions for the year
    const sessions: Array<Record<string, unknown>> = await of1(`/sessions?year=${year}&session_name=Race`);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return NextResponse.json({ data: { last_race: null, top3: [], message: "No race sessions" }, success: true });
    }

    // Find last completed session (date_end < now)
    const now = Date.now();
    const completed = sessions
      .map((s) => {
        const session = s as { date_end?: string; date_start?: string; session_name?: string; meeting_name?: string };
        return { ...session, end: new Date(session.date_end || session.date_start || '').getTime() };
      })
      .filter((s) => s.end < now)
      // filter to Grand Prix only by meeting_name if available
      .filter((s) => /grand prix/i.test(s.session_name || "Race") || /grand prix/i.test(s.meeting_name || ""))
      .sort((a, b) => a.end - b.end);

    if (!completed.length) {
      return NextResponse.json({ data: { last_race: null, top3: [], message: "No completed races" }, success: true });
    }

    const last = completed[completed.length - 1] as any;

    // Fetch session results
    const results: Array<Record<string, unknown>> = await of1(`/session_result?session_key=${last.session_key}`);
    const top = Array.isArray(results)
      ? results
          .filter((r: Record<string, unknown>) => (r as { position?: number }).position != null)
          .sort((a, b) => (a as { position: number }).position - (b as { position: number }).position)
          .slice(0, 3)
          .map((r) => {
            const rr = r as {
              position?: number
              full_name?: string
              broadcast_name?: string
              name_acronym?: string
              driver_number?: number
              team_name?: string
              points?: number
              status?: string
            }
            return ({
              position: rr.position ?? null,
              driver: rr.full_name || rr.broadcast_name || rr.name_acronym || `#${rr.driver_number}`,
              team: rr.team_name || "Unknown",
              points: rr.points ?? 0,
              status: rr.status || undefined,
            })
          })
      : [];

    const last_race = {
      round_number: completed.findIndex((s) => (s as any).session_key === last.session_key) + 1,
      country: (last as any).country_name || "",
      location: (last as any).location || (last as any).circuit_short_name || "",
      event_name: (last as any).meeting_official_name || (last as any).meeting_name || "Race",
      race_date: (last as any).date_end || (last as any).date_start,
    };

    return NextResponse.json({ data: { last_race, top3: top, source: "openf1" }, success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error)?.message ?? "unknown" }, { status: 500 });
  }
}
