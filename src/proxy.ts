import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Edge-level route protection for the (portal) route group, in addition
 * to the server-side check in `src/lib/tenant.ts`. Keeping both means a
 * protected page never renders for an unauthenticated request, even
 * before the page's own data fetching runs.
 */
export default auth((req) => {
  const isLoggedIn = Boolean(req.auth);
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/datasets/:path*",
    "/exchanges/:path*",
    "/upload/:path*",
    "/downloads/:path*",
    "/api-access/:path*",
    "/notifications/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
  ],
};
