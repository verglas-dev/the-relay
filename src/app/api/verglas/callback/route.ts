import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { callbackUrl, exchangeCode, publicOrigin, viewerLogin } from "@/lib/verglas-github";

export const dynamic = "force-dynamic";

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/verglas", publicOrigin(request));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const jar = cookies();
  const expected = jar.get("verglas_oauth_state")?.value;
  jar.delete("verglas_oauth_state");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (request.nextUrl.searchParams.get("error")) return back(request, { error: "declined" });
  if (!code || !state || !expected || state !== expected) return back(request, { error: "state" });

  try {
    const token = await exchangeCode(code, callbackUrl(publicOrigin(request)));
    const login = await viewerLogin(token);

    // httpOnly: the browser can prove who it is, but never read the token.
    jar.set("verglas_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    jar.set("verglas_login", login, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });

    return back(request, { signedin: login });
  } catch {
    return back(request, { error: "signin" });
  }
}
