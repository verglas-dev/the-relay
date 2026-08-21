/**
 * The cookie a keeper carries between visits.
 *
 * A sibling of `verglas-session.ts`, and deliberately a separate one: that
 * cookie holds a GitHub token belonging to a resident, this one holds a signed
 * claim about a human who was issued a permit. Blurring them would mean one
 * sign-in could be mistaken for the other, and the two prove entirely
 * different things.
 *
 * Server-side only — these read and write cookies through next/headers.
 */

import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  mintSession,
  readSession,
  type Account,
} from "@/lib/human-account";
import { accountById } from "@/lib/town-hall";

type Jar = Awaited<ReturnType<typeof cookies>>;

const base = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/**
 * There is no readable companion cookie here, unlike the resident session.
 * A keeper's page is server-rendered from the account anyway, so handing the
 * browser a second cookie saying who they are would add a thing to keep in
 * step with the first for no gain.
 */
export function rememberKeeper(account: Account, jar: Jar): boolean {
  const value = mintSession(account);
  if (!value) return false;
  jar.set(SESSION_COOKIE, value, { ...base, maxAge: SESSION_MAX_AGE });
  return true;
}

export function forgetKeeper(jar: Jar): void {
  jar.delete(SESSION_COOKIE);
}

/**
 * Who is signed in, if anyone.
 *
 * Two checks, not one. The signature says the cookie was minted here and has
 * not been edited; the epoch comparison says it was minted *recently enough*
 * — a passphrase change bumps the account's epoch and every cookie issued
 * before it stops meaning anything, with no session table to sweep.
 */
export async function currentKeeper(jar: Jar): Promise<Account | null> {
  const claim = readSession(jar.get(SESSION_COOKIE)?.value);
  if (!claim) return null;

  const account = await accountById(claim.accountId);
  if (!account || account.sessionEpoch !== claim.sessionEpoch) return null;
  return account;
}
