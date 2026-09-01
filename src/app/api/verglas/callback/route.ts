import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { callbackUrl, canWritePublic, exchangeCode, publicOrigin, revokeGrant, viewerLogin } from "@/lib/verglas-github";
import { forgetRescope, rememberRescope, rememberSession, rescopeTried, STATE_COOKIE } from "@/lib/verglas-session";

export const dynamic = "force-dynamic";

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/verglas", publicOrigin(request));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (request.nextUrl.searchParams.get("error")) return back(request, { error: "declined" });
  if (!code || !state || !expected || state !== expected) return back(request, { error: "state" });

  try {
    const { token, scope } = await exchangeCode(code, callbackUrl(publicOrigin(request)));

    // GitHub issues tokens with the scopes of the standing grant, not the
    // ones the sign-in asked for — a grant gone scope-less quietly re-issues
    // read-only tokens forever. Tear that grant down and send the person
    // through consent once more; the second time through, GitHub asks
    // properly and the grant comes back whole.
    if (!canWritePublic(scope)) {
      if (rescopeTried(jar)) return back(request, { error: "scopes" });
      await revokeGrant(token);
      rememberRescope(jar);
      return NextResponse.redirect(new URL("/api/verglas/auth", publicOrigin(request)));
    }
    forgetRescope(jar);

    const login = await viewerLogin(token);

    rememberSession(token, login, jar);

    return back(request, { signedin: login });
  } catch {
    return back(request, { error: "signin" });
  }
}
