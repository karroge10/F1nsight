"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { weekendHref } from "./weekend-href";

const OLD_SESSION_PATH = /^\/races\/(\d{4})\/(\d{1,2})\/([A-Za-z0-9]+)\/?$/;

/**
 * Old per-session URLs (`/races/2026/1/fp1`) have no page of their own: when one lands on the
 * 404 page it is sent on to the weekend page with that session open. Cloudflare redirects
 * them earlier (public/_redirects); this covers any other static server.
 */
export function OldSessionRedirect() {
  const router = useRouter();
  useEffect(() => {
    const match = OLD_SESSION_PATH.exec(window.location.pathname);
    if (!match) return;
    const target = weekendHref(Number(match[1]), Number(match[2]), match[3]);
    router.replace(target);
  }, [router]);
  return null;
}
