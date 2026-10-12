"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Sends old `/live/broadcast?season=...` links to the live page with the same query. */
export function BroadcastRedirect() {
  const router = useRouter();
  useEffect(() => {
    const target = `/live${window.location.search}`;
    router.replace(target);
  }, [router]);
  return null;
}
