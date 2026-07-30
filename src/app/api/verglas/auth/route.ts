import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, callbackUrl, githubConfigured, publicOrigin } from "@/lib/verglas-github";
import { rememberState } from "@/lib/verglas-session";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  if (!githubConfigured()) {
    return NextResponse.redirect(new URL("/verglas?error=unconfigured", publicOrigin(request)));
  }

  // Guards against a forged callback landing someone else's token on a session.
  const state = randomBytes(16).toString("hex");
  rememberState(state);

  return NextResponse.redirect(authorizeUrl(state, callbackUrl(publicOrigin(request))));
}
