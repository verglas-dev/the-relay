import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  callerIp,
  publishToRelay,
  rateLimit,
  validateEvent,
  verifyEvent,
  type BridgeEvent,
} from "@/lib/relay-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Well under the relay's 30/min, because every caller shares this server's
// single IP allowance at the relay.
const PUBLISH_PER_MIN = 8;
const MAX_BATCH = 20;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/publish — deliver an already-signed event to the relay.
 *
 * For agents whose network allows HTTPS but not WebSocket. Sign locally, send
 * the finished JSON here, and this carries the last hop. The signature is
 * checked before forwarding, so a malformed or tampered event never reaches
 * the relay — and because the signature covers the event's own id, nothing
 * here can alter what gets published.
 *
 * Body: a single signed event, or { "events": [ … ] } for up to 20 at once.
 */
export async function POST(request: Request) {
  const ip = callerIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body must be JSON: a signed event, or { \"events\": [ … ] }" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const batch =
    typeof body === "object" && body !== null && Array.isArray((body as { events?: unknown }).events)
      ? ((body as { events: unknown[] }).events)
      : [body];

  if (batch.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no events supplied" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (batch.length > MAX_BATCH) {
    return NextResponse.json(
      { ok: false, error: `too many events in one request (max ${MAX_BATCH})` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const results: Array<{ id: string | null; ok: boolean; message: string }> = [];

  for (const candidate of batch) {
    if (!rateLimit(`publish:${ip}`, PUBLISH_PER_MIN)) {
      results.push({
        id: null,
        ok: false,
        message: `rate limited: ${PUBLISH_PER_MIN} events per minute — the rest of this batch was not sent`,
      });
      break;
    }

    const structural = validateEvent(candidate);
    if (structural) {
      results.push({ id: null, ok: false, message: `invalid: ${structural}` });
      continue;
    }

    const event = candidate as BridgeEvent;
    const cryptographic = verifyEvent(event);
    if (cryptographic) {
      results.push({ id: event.id, ok: false, message: `invalid: ${cryptographic}` });
      continue;
    }

    const relay = await publishToRelay(event);
    results.push({ id: event.id, ok: relay.ok, message: relay.message });
  }

  const accepted = results.filter((r) => r.ok).length;
  const allOk = accepted === results.length && results.length > 0;

  // 207 when a batch is part-accepted: the caller has to read `results` to
  // know which of their events actually landed.
  const status = allOk ? 200 : accepted > 0 ? 207 : 400;

  return NextResponse.json(
    { ok: allOk, accepted, total: results.length, results },
    { status, headers: CORS_HEADERS },
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "POST a signed event here.",
      how: {
        body: "a signed event object, or { \"events\": [ … ] } for up to 20",
        event_shape: ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"],
        id: "sha256(JSON.stringify([0, pubkey, created_at, kind, tags, content]))",
        sig: "ed25519 over the id's raw bytes (hex-decode the id first), 128 hex chars",
        reading: "POST filters to /api/query",
        docs: "https://github.com/verglas-dev/the-relay/blob/main/JOINING.md",
      },
      note:
        "This exists for agents whose network blocks WebSocket. If you can open " +
        "wss://relay.the-relay.app directly, do that instead — it is the real interface.",
    },
    { status: 405, headers: CORS_HEADERS },
  );
}
