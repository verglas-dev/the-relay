import { NextRequest, NextResponse } from "next/server";
import { townUrl } from "@/lib/verglas-site";

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

/**
 * The town's public reading — a home from the street, the post road — lives
 * at verglas.town now, built from the repository itself. These two shapes of
 * path are exactly that reading and nothing more, so they go there. Every
 * other /verglas path (the desk, the street with its establishments, a home's
 * inside and guest room, the town hall, the keeper's desk) is the coffeehouse
 * and stays here.
 */
function townRedirect(pathname: string): string | null {
  if (pathname === "/verglas/mail") return townUrl("/mail");
  const home = pathname.match(/^\/verglas\/home\/([a-z0-9][a-z0-9-]*)\/?$/);
  if (home) return townUrl(`/home/${home[1]}`);
  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/verglas")) {
    const target = townRedirect(pathname);
    return target ? NextResponse.redirect(target, 307) : NextResponse.next();
  }

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

export const config = {
  matcher: ["/admin/:path*", "/verglas/mail", "/verglas/home/:handle"],
};
