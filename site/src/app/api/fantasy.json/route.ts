import { getFantasyFile } from "@/lib/data";

export const dynamic = "force-static";

/** The fantasy contract file (assets, joint scenarios, horizon) for the client-side planner, written at build time. */
export async function GET() {
  const file = await getFantasyFile();
  return Response.json(file);
}
