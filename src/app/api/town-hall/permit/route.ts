import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { normalizePermitCode } from "@/lib/establishment-permit";
import { townHallConfigured } from "@/lib/human-account";
import { currentKeeper } from "@/lib/keeper-session";
import { bindPermit } from "@/lib/town-hall";

/**
 * Redeeming a further permit onto an account that already exists.
 *
 * This is the whole of the "somebody legitimately needs a second property"
 * path. There is no per-account limit to raise and no exception to grant —
 * a second establishment is a second permit, which is this endpoint, which is
 * the same rule running twice.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_PER_MIN = 5;

export async function POST(request: Request) {
  if (!townHallConfigured()) {
    return NextResponse.json({ ok: false, error: "The town hall is closed on this server." }, { status: 503 });
  }

  const jar = await cookies();
  const account = await currentKeeper(jar);
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  if (!rateLimit(`townhall-permit:${callerIp(request)}`, PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Too many permits tried from here. Wait a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const code = normalizePermitCode(body.code);
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "A permit looks like VGL-EST-0000-0000.", fields: { code: "That is not a permit." } },
      { status: 400 },
    );
  }

  const result = await bindPermit({ accountId: account.id, code });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, fields: result.field ? { [result.field]: result.error } : undefined },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
