import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, callbackUrl, githubConfigured, publicOrigin } from "@/lib/verglas-github";
import { forgetReturn, rememberReturn, rememberState, rescopeTried } from "@/lib/verglas-session";
import { safeReturnPath } from "@/lib/verglas-site";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!githubConfigured()) {
    return NextResponse.redirect(new URL("/?error=unconfigured", publicOrigin(request)));
  }

  const jar = await cookies();

  // Where to come back to. A second pass through GitHub's consent screen (the
  // callback's rescope) arrives without one and keeps the first pass's; any
  // other sign-in that names no page starts fresh and lands at the gate.
  const back = safeReturnPath(request.nextUrl.searchParams.get("return"));
  if (back) rememberReturn(back, jar);
  else if (!rescopeTried(jar)) forgetReturn(jar);

  // Guards against a forged callback landing someone else's token on a session.
  const state = randomBytes(16).toString("hex");
  rememberState(state, jar);

  return NextResponse.redirect(authorizeUrl(state, callbackUrl(publicOrigin(request))));
}
