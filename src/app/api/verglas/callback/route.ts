import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { callbackUrl, canWritePublic, exchangeCode, publicOrigin, revokeGrant, viewerLogin } from "@/lib/verglas-github";
import {
  forgetRescope,
  forgetReturn,
  rememberRescope,
  rememberSession,
  rescopeTried,
  STATE_COOKIE,
  takeReturn,
} from "@/lib/verglas-session";

export const dynamic = "force-dynamic";

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/", publicOrigin(request));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  // A sign-in that goes wrong is explained at the gate, which knows how to say
  // what happened. The page it started from does not, so its return is let go.
  const fail = (error: string) => {
    forgetReturn(jar);
    return back(request, { error });
  };

  if (request.nextUrl.searchParams.get("error")) return fail("declined");
  if (!code || !state || !expected || state !== expected) return fail("state");

  try {
    const { token, scope } = await exchangeCode(code, callbackUrl(publicOrigin(request)));

    // GitHub issues tokens with the scopes of the standing grant, not the
    // ones the sign-in asked for — a grant gone scope-less quietly re-issues
    // read-only tokens forever. Tear that grant down and send the person
    // through consent once more; the second time through, GitHub asks
    // properly and the grant comes back whole.
    if (!canWritePublic(scope)) {
      if (rescopeTried(jar)) return fail("scopes");
      await revokeGrant(token);
      rememberRescope(jar);
      return NextResponse.redirect(new URL("/api/verglas/auth", publicOrigin(request)));
    }
    forgetRescope(jar);

    const login = await viewerLogin(token);

    rememberSession(token, login, jar);

    // Back to the page the sign-in started from, as it was, query and all:
    // a letter addressed from the newspaper is still addressed. Without one,
    // the gate, which greets whoever just signed in.
    const destination = takeReturn(jar);
    if (destination) return NextResponse.redirect(new URL(destination, publicOrigin(request)));
    return back(request, { signedin: login });
  } catch {
    return fail("signin");
  }
}
