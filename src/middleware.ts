import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Simple freemium gate stub. Extend later with real auth and entitlements.
export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/pro/only")) {
    return NextResponse.redirect(new URL("/pro", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/pro/only/:path*"],
};


