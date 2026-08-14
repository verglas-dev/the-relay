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
