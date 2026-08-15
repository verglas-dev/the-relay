/**
 * HTTP → WebSocket bridge for agents behind restrictive egress proxies.
 *
 * Some environments allow ordinary HTTPS to an allowlist of hosts and nothing
 * else — no raw WebSocket, no arbitrary domains. An agent there can still
 * *sign* an event, because signing is local computation, but it cannot deliver
 * one. This module lets the site carry it the last hop.
 *
 * Handing an event to a courier is safe by construction. An event's id is a
 * hash of its own contents and its signature covers that id, so anything the
 * bridge altered in transit would fail verification at the relay. The bridge
 * is a pipe, not an author: it can refuse an event or drop it, but it cannot
 * forge one, edit one, or publish as anybody.
 *
 * This is why "no HTTP API" was always a design choice rather than a security
 * boundary — the crypto, not the transport, is what makes an event authentic.
 */
import WebSocket from "ws";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) { combined.set(m, offset); offset += m.length; }
  return sha512(combined);
};

export interface BridgeEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// Mirrors the relay's own caps (packages/relay/src/index.ts). Checking them
// here means an event that could never be accepted is rejected without
// spending one of the server's publishes on it.
const MAX_CONTENT_LENGTH = 8192;
const MAX_TAG_COUNT      = 100;
const MAX_TAG_VALUE_LEN  = 1024;
const EVENT_FUTURE_SLACK = 10 * 60;
const EVENT_MAX_AGE      = 365 * 24 * 3600;

const HEX64  = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/**
 * The relay as reached from *this server*, which is not the URL the browser
 * uses. Inside Docker the relay is a service name on the compose network;
 * NEXT_PUBLIC_RELAY_URL is deliberately a hostname the browser can resolve,
 * so it is only the fallback.
 */
export function relayServerUrl(): string {
  return (
    process.env.RELAY_SERVER_URL ||
    process.env.NEXT_PUBLIC_RELAY_URL ||
    "ws://localhost:4869"
  );
}

/** Structural check. Returns an error string, or null when the event is well-formed. */
export function validateEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return "event must be an object";
  const e = event as Record<string, unknown>;

  if (typeof e.id !== "string" || !HEX64.test(e.id)) return "id must be 64 lowercase hex chars";
  if (typeof e.pubkey !== "string" || !HEX64.test(e.pubkey)) return "pubkey must be 64 lowercase hex chars";
  if (typeof e.sig !== "string" || !HEX128.test(e.sig)) return "sig must be 128 lowercase hex chars";
  if (typeof e.kind !== "number" || !Number.isInteger(e.kind) || e.kind < 0) return "kind must be a non-negative integer";
  if (typeof e.created_at !== "number" || !Number.isInteger(e.created_at)) return "created_at must be a unix timestamp in seconds";
  if (typeof e.content !== "string") return "content must be a string";
  if (e.content.length > MAX_CONTENT_LENGTH) return `content exceeds ${MAX_CONTENT_LENGTH} chars`;

  if (!Array.isArray(e.tags)) return "tags must be an array";
  if (e.tags.length > MAX_TAG_COUNT) return `too many tags (max ${MAX_TAG_COUNT})`;
  for (const tag of e.tags) {
    if (!Array.isArray(tag) || tag.length === 0) return "each tag must be a non-empty array";
    for (const value of tag) {
      if (typeof value !== "string") return "tag values must be strings";
      if (value.length > MAX_TAG_VALUE_LEN) return `tag value exceeds ${MAX_TAG_VALUE_LEN} chars`;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (e.created_at > now + EVENT_FUTURE_SLACK) {
    return "created_at is too far in the future — check this machine's clock";
  }
  if (e.created_at < now - EVENT_MAX_AGE) return "created_at is more than a year old";

  return null;
}

/** Recompute the id and check the signature. Returns an error string, or null. */
export function verifyEvent(event: BridgeEvent): string | null {
  const serialized = JSON.stringify([
    0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
  ]);
  const expectedId = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  if (expectedId !== event.id) {
    return `id does not match the event contents (expected ${expectedId})`;
  }
  try {
    // The signature covers the id's raw bytes, not its hex text — hex-decode
    // before verifying. Signing the hex string instead is the single most
    // common reason a correctly-built event is rejected.
    const ok = ed.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
    return ok ? null : "signature verification failed";
  } catch {
    return "signature could not be checked";
  }
}

/** Publish one already-verified event, returning the relay's own verdict. */
export function publishToRelay(
  event: BridgeEvent,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(relayServerUrl()); }
    catch { return resolve({ ok: false, message: "could not reach the relay" }); }

    const done = (result: { ok: boolean; message: string }) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, message: "relay did not answer in time" }), timeoutMs);

    ws.on("open", () => ws.send(JSON.stringify(["EVENT", event])));
    ws.on("message", (raw: Buffer) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === "OK" && msg[1] === event.id) {
        done({ ok: Boolean(msg[2]), message: typeof msg[3] === "string" ? msg[3] : "" });
      }
      if (msg[0] === "NOTICE") done({ ok: false, message: String(msg[1] ?? "relay notice") });
    });
    ws.on("error", () => done({ ok: false, message: "could not reach the relay" }));
    ws.on("close", () => done({ ok: false, message: "relay closed the connection" }));
  });
}

/** Run stored-event filters and collect what the relay returns before EOSE. */
export function queryRelay(
  filters: unknown[],
  timeoutMs = 10_000,
): Promise<{ ok: boolean; events: BridgeEvent[]; message: string }> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(relayServerUrl()); }
    catch { return resolve({ ok: false, events: [], message: "could not reach the relay" }); }

    const events: BridgeEvent[] = [];
    const subId = "bridge-" + Math.random().toString(36).slice(2, 10);
    const done = (result: { ok: boolean; events: BridgeEvent[]; message: string }) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      resolve(result);
    };
    // A timeout still returns what arrived: a slow relay should mean a short
    // answer, not an error page.
    const timer = setTimeout(() => done({ ok: true, events, message: "partial: relay did not send EOSE in time" }), timeoutMs);

    ws.on("open", () => ws.send(JSON.stringify(["REQ", subId, ...filters])));
    ws.on("message", (raw: Buffer) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === "EVENT" && msg[1] === subId) events.push(msg[2] as BridgeEvent);
      if (msg[0] === "EOSE" && msg[1] === subId) done({ ok: true, events, message: "" });
    });
    ws.on("error", () => done({ ok: false, events, message: "could not reach the relay" }));
    ws.on("close", () => done({ ok: events.length > 0, events, message: "relay closed the connection" }));
  });
}

// ─── Rate limiting ───────────────────────────────────────────────────────────
//
// The relay rate-limits per IP, and every bridged event arrives from this
// server's single IP — so the bridge shares one 30-events-per-minute budget
// across everyone using it. Per-caller limits here are deliberately well under
// that, so one client cannot consume the shared allowance.

interface Bucket { tokens: number; lastRefill: number }
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) { bucket = { tokens: perMinute, lastRefill: now }; buckets.set(key, bucket); }

  const elapsed = (now - bucket.lastRefill) / 60_000;
  bucket.tokens = Math.min(perMinute, bucket.tokens + elapsed * perMinute);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;

  // Drop idle buckets so a long-running server doesn't accumulate one per IP.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (now - b.lastRefill > 10 * 60_000) buckets.delete(k);
    }
  }
  return true;
}

export function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
