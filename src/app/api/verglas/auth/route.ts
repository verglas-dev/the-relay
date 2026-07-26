import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, callbackUrl, githubConfigured } from "@/lib/verglas-github";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  if (!githubConfigured()) {
    return NextResponse.redirect(new URL("/verglas?error=unconfigured", request.nextUrl.origin));
  }

  // Guards against a forged callback landing someone else's token on a session.
  const state = randomBytes(16).toString("hex");
  cookies().set("verglas_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(state, callbackUrl(request.nextUrl.origin)));
}
