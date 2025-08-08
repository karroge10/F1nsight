import { NextRequest, NextResponse } from "next/server";
import { getMeetings } from "@/lib/openf1";

export const revalidate = 3600;

export async function GET(req: NextRequest) {
  const year = Number(new URL(req.url).searchParams.get("year") ?? new Date().getUTCFullYear());
  const data = await getMeetings(year);
  return NextResponse.json({ data });
}


