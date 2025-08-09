import { NextResponse } from "next/server";

export const revalidate = 1800; // 30 minutes

const FASTF1_API_URL = "http://localhost:8000";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year") || new Date().getFullYear().toString();
    const round = searchParams.get("round");
    const limit = searchParams.get("limit") || "3";

    if (!round) {
      return NextResponse.json({ error: "round is required" }, { status: 400 });
    }

    const res = await fetch(`${FASTF1_API_URL}/race-results/${year}/${round}?limit=${limit}`, {
      next: { revalidate }
    });

    if (!res.ok) {
      throw new Error(`FastF1 race-results failed: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json({ data, success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error)?.message ?? "unknown" }, { status: 500 });
  }
}
