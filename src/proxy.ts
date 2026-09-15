import { NextRequest, NextResponse } from "next/server";
import { isTownHost, requestHost, townHost, townUrl } from "@/lib/verglas-site";

const encoder = new TextEncoder();

async function equalSecret(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);

  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

function basicCredentials(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

async function adminGate(request: NextRequest) {
  const password = (process.env.ADMIN_PAGE_PASSWORD || process.env.ADMIN_API_TOKEN)?.trim();
  const username = process.env.ADMIN_PAGE_USERNAME?.trim() || "operatorconf";

  // Fail closed: a missing secret must never turn the admin page public.
  if (!password) {
    return new NextResponse("Admin access is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const credentials = basicCredentials(request.headers.get("authorization"));
  const authorized = credentials
    ? (await equalSecret(credentials.username, username)) &&
      (await equalSecret(credentials.password, password))
    : false;

  if (!authorized) {
    return new NextResponse("Not found.", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Admin", charset="UTF-8"',
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

/** Paths that mean the same thing on either host and are never the town's. */
function sharedPath(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  // Files in public/ and the metadata routes: /llms.txt, /robots.txt,
  // /sitemap.xml, /favicon.ico, /verglas-window.png, …
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".");
}

/**
 * The town's front door. Everything under verglas.town is the town, served by
 * the routes that live under /verglas in this app: `/` is the gate,
 * `/street` the street, `/home/akihu` a home. The address bar never shows
 * the /verglas prefix, and the www. twin folds into the apex.
 */
function townRequest(request: NextRequest, host: string) {
  const { pathname, search } = request.nextUrl;
  const apex = townHost();

  if (host !== apex) {
    return NextResponse.redirect(`${schemeFor(request)}://${apex}${pathname}${search}`, 308);
  }

  // An old link with the prefix on it: fold it away rather than serve twice.
  if (pathname === "/verglas" || pathname.startsWith("/verglas/")) {
    const bare = pathname.slice("/verglas".length) || "/";
    return NextResponse.redirect(`${schemeFor(request)}://${apex}${bare}${search}`, 308);
  }

  if (sharedPath(pathname)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? "/verglas" : `/verglas${pathname}`;
  return NextResponse.rewrite(url);
}

function schemeFor(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.nextUrl.protocol.replace(":", "");
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = requestHost(request.headers).toLowerCase();

  if (isTownHost(host)) return townRequest(request, host);

  if (pathname.startsWith("/admin")) return adminGate(request);

  // The coffeehouse used to render the town under /verglas. Those links are
  // out in the world; they now lead to the town's own address.
  if (pathname === "/verglas" || pathname.startsWith("/verglas/")) {
    const bare = pathname.slice("/verglas".length) || "/";
    return NextResponse.redirect(`${townUrl(bare)}${search}`, 308);
  }
  // Key recovery signs in through the town's GitHub app, so it lives there.
  if (pathname === "/recovery") return NextResponse.redirect(`${townUrl("/recovery")}${search}`, 308);

  return NextResponse.next();
}

export const config = {
  // Everything but Next's own static chunks, so the town host can rewrite
  // any path. Static files are let through by sharedPath() above.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
