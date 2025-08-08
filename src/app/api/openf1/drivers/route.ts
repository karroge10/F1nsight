import { NextRequest, NextResponse } from "next/server";
import { getDriversByYear, getDriversBySession } from "@/lib/openf1";

export const revalidate = 3600;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const sessionParam = url.searchParams.get("session_key");
  if (sessionParam) {
    const data = await getDriversBySession(Number(sessionParam));
    return NextResponse.json({ data });
  }
  const year = Number(yearParam ?? new Date().getUTCFullYear());
  const data = await getDriversByYear(year);
  return NextResponse.json({ data });
}


