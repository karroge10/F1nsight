import { notFound } from "next/navigation";
import { getSessionTelemetry, getTelemetryIndex } from "@/lib/data";
import { parseSessionKey, sessionKey } from "@/lib/telemetry";

type Params = Promise<{ file: string }>;

export const dynamic = "force-static";
export const dynamicParams = false;

/** One file per exported session: `/api/telemetry/2026-16-Q.json`, loaded by the telemetry page. */
export async function generateStaticParams(): Promise<{ file: string }[]> {
  const index = await getTelemetryIndex();
  return index.map((entry) => ({ file: `${sessionKey(entry)}.json` }));
}

export async function GET(_request: Request, context: { params: Params }) {
  const { file } = await context.params;
  const key = file.replace(/\.json$/, "");
  const ref = parseSessionKey(key);
  const session = ref ? await getSessionTelemetry(ref) : null;
  if (!session) notFound();
  return Response.json(session);
}
