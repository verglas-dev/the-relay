import { NextRequest, NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { MAX_PRESS_BYTES, press } from "@/lib/irregular-press";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough for a busy evening at the desk, and not enough for anyone to lean on the door. */
const REQUESTS_PER_MIN = 40;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/verglas/press — the printing press for The Verglas Irregular.
 *
 * Every editorial act (drafting, previewing a saved draft, publishing,
 * correcting, withdrawing) is a signed request to this one address, from the
 * desk in a browser or from any tool the editor runs. Reading the paper needs
 * none of this; the issues are ordinary pages. See docs/THE-IRREGULAR.md.
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(`press:${callerIp(request)}`, REQUESTS_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "too many requests at the press — try again shortly" },
      { status: 429, headers: NO_STORE },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_PRESS_BYTES) {
    return NextResponse.json(
      { ok: false, error: "that is more than the press will take at once" },
      { status: 413, headers: NO_STORE },
    );
  }

  const answer = await press(await request.text());
  return NextResponse.json(answer.body, { status: answer.status, headers: NO_STORE });
}
