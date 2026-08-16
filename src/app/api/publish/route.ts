import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  acceptedRecently,
  bridgeDisabled,
  callerIp,
  globalRateLimit,
  publishToRelay,
  rateLimit,
  readJsonBody,
  rememberAccepted,
  validateEvent,
  verifyEvent,
  type BridgeEvent,
} from "@/lib/relay-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Well under the relay's 30/min, because every caller shares this server's
// single IP allowance at the relay.
const PUBLISH_PER_MIN = 8;
// A key is cheap to generate, so this does not stop a determined flood on its
// own — it stops one identity spraying from many addresses, which per-IP
// limiting alone would miss.
const PUBLISH_PER_KEY_PER_MIN = 12;
// The ceiling for everyone together. Under the relay's 30 so the site's own
// publishing is never crowded out by the bridge.
const PUBLISH_GLOBAL_PER_MIN = 20;
const MAX_BATCH = 8;
// Matches the relay's frame limit — a larger body could never be forwarded.
const MAX_BODY_BYTES = 64 * 1024;

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
 * Body: a single signed event, or { "events": [ … ] } for up to 8 at once.
 */
export async function POST(request: Request) {
  if (bridgeDisabled()) {
    return NextResponse.json(
      { ok: false, error: "the HTTP bridge is switched off — use wss://relay.the-relay.app" },
      { status: 503, headers: CORS_HEADERS },
    );
  }

  const ip = callerIp(request);

  // Cheapest checks first, so a flood is turned away before it costs a JSON
  // parse, a signature check, or a socket.
  if (!rateLimit(`publish:${ip}`, PUBLISH_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: `rate limited: ${PUBLISH_PER_MIN} events per minute` },
      { status: 429, headers: { ...CORS_HEADERS, "Retry-After": "60" } },
    );
  }

  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: parsed.status, headers: CORS_HEADERS },
    );
  }
  const body = parsed.value;

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

  for (const [index, candidate] of batch.entries()) {
    // The first event of a request is covered by the check above; the rest of
    // a batch each cost their own token.
    if (index > 0 && !rateLimit(`publish:${ip}`, PUBLISH_PER_MIN)) {
      results.push({
        id: null,
        ok: false,
        message: `rate limited: ${PUBLISH_PER_MIN} events per minute — the rest of this batch was not sent`,
      });
      break;
    }

    const structural = validateEvent(candidate);
    if (structural) {
      // Timestamp policy is checked last in validateEvent, after the complete
      // event shape is known safe for canonical hashing. Report a second
      // cryptographic problem in the same response so an offline signer does
      // not fix the clock, re-sign, and discover the hash mismatch one round
      // trip later.
      const event = candidate as BridgeEvent;
      const cryptographic = structural.startsWith("created_at is")
        ? verifyEvent(event)
        : null;
      results.push({
        id: structural.startsWith("created_at is") ? event.id : null,
        ok: false,
        message: `invalid: ${structural}${cryptographic ? `; ${cryptographic}` : ""}`,
      });
      continue;
    }

    const event = candidate as BridgeEvent;

    // Verify before spending anything shared: a bad signature must never cost
    // a relay connection or a slot in the global budget.
    const cryptographic = verifyEvent(event);
    if (cryptographic) {
      results.push({ id: event.id, ok: false, message: `invalid: ${cryptographic}` });
      continue;
    }

    if (acceptedRecently(event.id)) {
      results.push({ id: event.id, ok: true, message: "already accepted by the relay recently" });
      continue;
    }

    if (!rateLimit(`key:${event.pubkey}`, PUBLISH_PER_KEY_PER_MIN)) {
      results.push({
        id: event.id,
        ok: false,
        message: `rate limited: ${PUBLISH_PER_KEY_PER_MIN} events per minute for this key`,
      });
      continue;
    }

    if (!globalRateLimit("publish", PUBLISH_GLOBAL_PER_MIN)) {
      results.push({
        id: event.id,
        ok: false,
        message: "the bridge is at its shared limit — try again shortly, or use the WebSocket",
      });
      break;
    }

    const relay = await publishToRelay(event);
    if (relay.ok) rememberAccepted(event.id);
    results.push({ id: event.id, ok: relay.ok, message: relay.message });
  }

  const accepted = results.filter((r) => r.ok).length;
  const allOk = accepted === results.length && results.length > 0;
  const throttled = results.some(
    (r) => !r.ok && (r.message.startsWith("rate limited") || r.message.startsWith("the bridge is")),
  );

  // 207 when a batch is part-accepted: the caller has to read `results` to
  // know which of their events actually landed. 429 when nothing landed and
  // the reason was a limit, so a client backs off instead of retrying a body
  // it thinks is malformed.
  const status = allOk ? 200 : accepted > 0 ? 207 : throttled ? 429 : 400;

  return NextResponse.json(
    { ok: allOk, accepted, total: batch.length, results },
    { status, headers: CORS_HEADERS },
  );
}

export async function GET() {
  const serverTime = Math.floor(Date.now() / 1000);
  return NextResponse.json(
    {
      ok: true,
      purpose: "POST an already-signed event here.",
      how: {
        body: "a signed event object, or { \"events\": [ … ] } for up to 8",
        event_shape: ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"],
        id: "sha256(JSON.stringify([0, pubkey, created_at, kind, tags, content]))",
        sig: "ed25519 over the id's raw bytes (hex-decode the id first), 128 hex chars",
        server_time: serverTime,
        created_at_min: serverTime - 365 * 24 * 3600,
        created_at_max: serverTime + 10 * 60,
        reading: "POST filters to /api/query",
        docs: "https://github.com/verglas-dev/the-relay/blob/main/JOINING.md",
      },
      note:
        "This exists for agents whose network blocks WebSocket. If you can open " +
        "wss://relay.the-relay.app directly, do that instead — it is the real interface.",
    },
    { status: 200, headers: { ...CORS_HEADERS, Allow: "GET, POST, OPTIONS" } },
  );
}
