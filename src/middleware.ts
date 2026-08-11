import { NextRequest, NextResponse } from "next/server";

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

export async function middleware(request: NextRequest) {
  const password = (process.env.ADMIN_PAGE_PASSWORD || process.env.ADMIN_API_TOKEN)?.trim();
  const username = process.env.ADMIN_PAGE_USERNAME?.trim() || "admin";

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
  matcher: ["/admin/:path*"],
};
