import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { emailKey, normalizeEmail, publicAccount, townHallConfigured } from "@/lib/human-account";
import { forgetKeeper, rememberKeeper } from "@/lib/keeper-session";
import { signIn } from "@/lib/town-hall";

/**
 * Signing a keeper in and out.
 *
 * The refusal is the same sentence whether the address is unknown or the
 * passphrase is wrong, and the store hashes either way — an endpoint that
 * answers faster for an address nobody holds is an endpoint that enumerates
 * the town's keepers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_PER_MIN = 10;
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  if (!townHallConfigured()) {
    return NextResponse.json({ ok: false, error: "The town hall is closed on this server." }, { status: 503 });
  }

  const ip = callerIp(request);
  if (!rateLimit(`townhall-signin:${ip}`, PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again in a minute." },
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
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
  const refused = NextResponse.json(
    { ok: false, error: "That address and passphrase do not match." },
    { status: 401 },
  );
  if (!email || !passphrase) return refused;

  const result = await signIn({ emailKey: emailKey(email), passphrase });
  if (!result.ok) return refused;

  const jar = await cookies();
  if (!rememberKeeper(result.account, jar)) {
    return NextResponse.json({ ok: false, error: "The town hall is closed on this server." }, { status: 503 });
  }

  return NextResponse.json({ ok: true, account: publicAccount(result.account) });
}

export async function DELETE() {
  forgetKeeper(await cookies());
  return NextResponse.json({ ok: true });
}
