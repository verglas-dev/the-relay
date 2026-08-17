import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { githubConfigured, viewerLogin } from "@/lib/verglas-github";
import { forgetSession, rememberSession, sessionToken } from "@/lib/verglas-session";
import { listResidents, readResident } from "@/lib/verglas-town";
import {
  getRecoveryRequest,
  openRecoveryRequest,
} from "@/lib/recovery-request-store";
import { requesterView } from "@/lib/recovery-requests";

export const dynamic = "force-dynamic";

/**
 * The house a GitHub account owns, and the key that house is bound to.
 *
 * This is the whole identity proof: ADDRESS.md pairs a `github:` login with a
 * `key:`, both committed publicly and dated long before anyone lost anything.
 * Signing in with that account is therefore proof of who the key belonged to,
 * without the operator having to judge a story.
 */
async function residentForLogin(login: string) {
  for (const entry of await listResidents()) {
    const resident = await readResident(entry.handle);
    if (resident?.github === login.toLowerCase()) return { handle: entry.handle, resident };
  }
  return null;
}

async function requireLogin() {
  const jar = await cookies();
  const token = sessionToken(jar);
  if (!token) return { error: NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 }) };

  let login: string;
  try {
    login = await viewerLogin(token);
  } catch {
    forgetSession(jar);
    return { error: NextResponse.json({ error: "That sign-in has expired. Sign in again." }, { status: 401 }) };
  }
  rememberSession(token, login, jar);
  return { login: login.toLowerCase(), token };
}

/**
 * GET /api/verglas/recovery — what this signed-in account can recover, and how
 * far along any request of theirs already is.
 */
export async function GET() {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Recovery is not configured on this server." }, { status: 503 });
  }

  const auth = await requireLogin();
  if (auth.error) return auth.error;

  const match = await residentForLogin(auth.login);
  if (!match) {
    return NextResponse.json({
      login: auth.login,
      eligible: false,
      reason: "No home in Verglas names this GitHub account, so there is nothing here to match a lost key against.",
    });
  }
  if (!match.resident.key) {
    return NextResponse.json({
      login: auth.login,
      eligible: false,
      handle: match.handle,
      reason: `The home at ${match.handle} has no key on file, so there is no identity recorded to give back.`,
    });
  }

  const existing = await getRecoveryRequest(auth.login);
  return NextResponse.json({
    login: auth.login,
    eligible: true,
    handle: match.handle,
    name: match.resident.resident.name,
    oldPubkey: match.resident.key,
    request: existing ? requesterView(existing) : null,
  });
}

/** POST /api/verglas/recovery — open a request for the operator to approve. */
export async function POST() {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Recovery is not configured on this server." }, { status: 503 });
  }

  const auth = await requireLogin();
  if (auth.error) return auth.error;

  const match = await residentForLogin(auth.login);
  if (!match?.resident.key) {
    return NextResponse.json(
      { error: "No home in Verglas binds this GitHub account to a key." },
      { status: 403 },
    );
  }

  const request = await openRecoveryRequest({
    login: auth.login,
    handle: match.handle,
    oldPubkey: match.resident.key,
  });

  return NextResponse.json({ request: requesterView(request) }, { status: 201 });
}
