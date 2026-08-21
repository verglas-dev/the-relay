import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import {
  checkPassphrase,
  emailKey,
  normalizeEmail,
  publicAccount,
  townHallConfigured,
} from "@/lib/human-account";
import { normalizePermitCode } from "@/lib/establishment-permit";
import { rememberKeeper } from "@/lib/keeper-session";
import { registerKeeper } from "@/lib/town-hall";

/**
 * Opening a keeper's account.
 *
 * **The permit is required here, not only at the establishment form.** If
 * accounts were free and the permit were checked one step later, this endpoint
 * would be exactly the public faucet the permit exists to avoid — anyone could
 * make as many accounts as a rate limit allows, and the gate would only be
 * holding the last door. Asking for the code up front means every account in
 * the town belongs to somebody the town handed something to.
 *
 * Redeeming binds the permit to the account. It is not spent until an
 * establishment is actually opened with it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous for a person filling in a form once, useless for a script. */
const PER_IP_PER_MIN = 5;
/** Attempts that get as far as being parsed at all. */
const REQUESTS_PER_IP_PER_MIN = 20;
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  if (!townHallConfigured()) {
    return NextResponse.json(
      { ok: false, error: "The town hall is closed on this server." },
      { status: 503 },
    );
  }

  const ip = callerIp(request);
  if (!rateLimit(`townhall-req:${ip}`, REQUESTS_PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "That's a lot of attempts at once. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "That request is too large." }, { status: 413 });
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const passphraseProblem = checkPassphrase(body.passphrase);
  const code = normalizePermitCode(body.code);

  const fields: Record<string, string> = {};
  if (!email) fields.email = "An address the town can reach you at.";
  if (passphraseProblem) fields.passphrase = passphraseProblem;
  if (!code) fields.code = "A permit looks like VGL-EST-0000-0000.";
  if (Object.keys(fields).length > 0) {
    return NextResponse.json({ ok: false, error: "Some answers still need work.", fields }, { status: 400 });
  }

  // Only guessing costs a permit-check. A malformed form does not, so somebody
  // correcting a typo is never told to come back in a minute.
  if (!rateLimit(`townhall-permit:${ip}`, PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Too many permits tried from here. Wait a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const result = await registerKeeper({
    email: email as string,
    emailKey: emailKey(email as string),
    passphrase: body.passphrase as string,
    code: code as string,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, fields: result.field ? { [result.field]: result.error } : undefined },
      { status: 400 },
    );
  }

  const jar = await cookies();
  if (!rememberKeeper(result.account, jar)) {
    return NextResponse.json(
      { ok: false, error: "The account was opened, but the town could not sign you in. Try signing in." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, account: publicAccount(result.account) });
}
