/**
 * The GitHub session a browser carries between visits.
 *
 * The card on /verglas promises "sign in once", so this is the one place that
 * decides how long that lasts. There is no session table behind it: the token
 * GitHub issued *is* the session, and it lives only in the cookie. A GitHub
 * OAuth App token stays valid until the person revokes it, so a short cookie
 * throws away a perfectly good token and asks someone to sign in again for no
 * reason. We keep it for a season instead, and renew it whenever the token is
 * used, so anyone who visits now and then never signs in twice.
 *
 * Server-side only — these read and write cookies through next/headers.
 */

import { cookies } from "next/headers";
import { safeReturnPath } from "@/lib/verglas-site";

/**
 * Ninety days. Long enough that returning to the town feels like coming back
 * to a house you already have a key to; short enough that a browser nobody
 * uses anymore eventually forgets.
 */
const SESSION_MAX_AGE = 60 * 60 * 24 * 90;

/** Ten minutes is plenty for a round trip to GitHub and back. */
const STATE_MAX_AGE = 600;

export const STATE_COOKIE = "verglas_oauth_state";
const TOKEN_COOKIE = "verglas_token";
const LOGIN_COOKIE = "verglas_login";

type Jar = Awaited<ReturnType<typeof cookies>>;

const base = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/** The single-use value that ties a callback to the sign-in that started it. */
export function rememberState(state: string, jar: Jar): void {
  jar.set(STATE_COOKIE, state, { ...base, httpOnly: true, maxAge: STATE_MAX_AGE });
}

const RESCOPE_COOKIE = "verglas_rescope";

/**
 * A sign-in that came back without write permission gets sent through
 * GitHub's consent screen once more, and this is the once: if the second
 * pass is still short a scope, something beyond a stale grant is wrong, and
 * looping the person through GitHub forever would not name it.
 */
export function rememberRescope(jar: Jar): void {
  jar.set(RESCOPE_COOKIE, "1", { ...base, httpOnly: true, maxAge: STATE_MAX_AGE });
}

export function rescopeTried(jar: Jar): boolean {
  return jar.get(RESCOPE_COOKIE)?.value === "1";
}

export function forgetRescope(jar: Jar): void {
  jar.delete(RESCOPE_COOKIE);
}

const RETURN_COOKIE = "verglas_return";

/**
 * The page a sign-in started from, held while the visitor is at GitHub. It
 * lasts as long as the state does and is checked again on the way back, so a
 * tampered cookie can send nobody off the site.
 */
export function rememberReturn(path: string, jar: Jar): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  jar.set(RETURN_COOKIE, Buffer.from(safe, "utf8").toString("base64url"), {
    ...base,
    httpOnly: true,
    maxAge: STATE_MAX_AGE,
  });
}

/** The page to come back to, used once. */
export function takeReturn(jar: Jar): string | null {
  const raw = jar.get(RETURN_COOKIE)?.value;
  jar.delete(RETURN_COOKIE);
  if (!raw) return null;
  try {
    return safeReturnPath(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function forgetReturn(jar: Jar): void {
  jar.delete(RETURN_COOKIE);
}

/**
 * Store the session. The token is httpOnly — the browser can prove who it is
 * but never read it — while the login beside it is deliberately readable, so
 * the page can greet someone without a round trip.
 */
export function rememberSession(token: string, login: string, jar: Jar): void {
  jar.set(TOKEN_COOKIE, token, { ...base, httpOnly: true, maxAge: SESSION_MAX_AGE });
  jar.set(LOGIN_COOKIE, login, { ...base, httpOnly: false, maxAge: SESSION_MAX_AGE });
}

export function sessionToken(jar: Jar): string | undefined {
  return jar.get(TOKEN_COOKIE)?.value;
}

/**
 * Forget the session. Both cookies go together: leaving the readable login
 * behind would show someone as signed in with nothing to sign anything with.
 */
export function forgetSession(jar: Jar): void {
  jar.delete(TOKEN_COOKIE);
  jar.delete(LOGIN_COOKIE);
}
