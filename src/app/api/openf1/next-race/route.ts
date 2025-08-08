import { NextResponse } from "next/server";
import { getNextRace } from "@/lib/openf1";

export const revalidate = 3600; // cache for 1 hour

export async function GET() {
  try {
    const data = await getNextRace();
    return NextResponse.json({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}


