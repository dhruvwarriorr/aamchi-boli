import { type NextRequest, NextResponse } from "next/server";

/** Keep the hackathon prototype public; no login or database is required. */
export function proxy(request: NextRequest) {
  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and image optimization.
     * API routes are included so the session cookie is refreshed.
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
