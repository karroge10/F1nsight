import { sessionSpec } from "@/lib/sessions";

/** `/races/<season>/<round>?session=<slug>`: the race weekend page with one session open. */
export function weekendHref(season: number, round: number, keyOrCode: string): string {
  const spec = sessionSpec(keyOrCode);
  const base = `/races/${season}/${round}`;
  if (!spec) return base;
  return `${base}?session=${spec.slug}`;
}
