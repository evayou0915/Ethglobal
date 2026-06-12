import { NextRequest, NextResponse } from "next/server";

/** Redirect legacy /intent-detail.html?id=<bytes32> → /intent/<bytes32>.
 *  Next's static `redirects()` in next.config.js can't lift a query param
 *  into a path segment, so this lives in middleware. The static .html file
 *  itself is gone, but external links / cached share URLs may still hit
 *  this path. */
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/intent-detail.html") {
    const id = req.nextUrl.searchParams.get("id");
    const target = id ? `/intent/${encodeURIComponent(id)}` : "/market";
    return NextResponse.redirect(new URL(target, req.url), 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/intent-detail.html"],
};
