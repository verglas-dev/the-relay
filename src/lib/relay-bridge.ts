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

// ─── Guardrails ──────────────────────────────────────────────────────────────
//
// An HTTP endpoint is far easier to hammer than a WebSocket, and everything it
// forwards lands on the relay as this one server. So the bridge has to protect
// three shared things: the relay's 30-events-per-minute budget for our IP, its
// 50-concurrent-connection ceiling for our IP, and this process's memory.

/** An off switch that needs no code change — set BRIDGE_DISABLED=1 and restart. */
export function bridgeDisabled(): boolean {
  const flag = process.env.BRIDGE_DISABLED;
  return flag === "1" || flag === "true";
}

/**
 * Read a JSON body with a hard ceiling.
 *
 * Without this, a request advertising no length can stream until the process
 * runs out of memory. The cap matches the relay's own 64 KB frame limit: a
 * body larger than that could never be forwarded anyway.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    return { ok: false, status: 413, error: `body exceeds ${maxBytes} bytes` };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "could not read request body" };
  }
  if (text.length > maxBytes) {
    return { ok: false, status: 413, error: `body exceeds ${maxBytes} bytes` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "body must be valid JSON" };
  }
}

/**
 * A ceiling on everything the bridge sends, across every caller.
 *
 * Per-IP limits alone stop one client, not a thousand. Since every bridged
 * event reaches the relay from this server's single IP, the whole bridge has
 * to stay inside one budget or it starves itself — and the site with it.
 */
const globalBuckets = new Map<string, { tokens: number; lastRefill: number }>();

export function globalRateLimit(name: string, perMinute: number): boolean {
  const now = Date.now();
  let bucket = globalBuckets.get(name);
  if (!bucket) { bucket = { tokens: perMinute, lastRefill: now }; globalBuckets.set(name, bucket); }
  const elapsed = (now - bucket.lastRefill) / 60_000;
  bucket.tokens = Math.min(perMinute, bucket.tokens + elapsed * perMinute);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * Republishing an event the relay already stores costs a connection and a
 * publish token to be told "duplicate". Remembering recent ids turns a replay
 * flood into a cheap local lookup.
 */
const recentIds = new Map<string, number>();
const RECENT_ID_TTL = 10 * 60_000;
const RECENT_ID_MAX = 5000;

export function seenRecently(id: string): boolean {
  const now = Date.now();
  const at = recentIds.get(id);
  if (at !== undefined && now - at < RECENT_ID_TTL) return true;
  recentIds.set(id, now);
  if (recentIds.size > RECENT_ID_MAX) {
    for (const [key, when] of recentIds) {
      if (now - when > RECENT_ID_TTL) recentIds.delete(key);
      if (recentIds.size <= RECENT_ID_MAX) break;
    }
    // Still full of fresh entries: drop the oldest rather than grow forever.
    while (recentIds.size > RECENT_ID_MAX) {
      const oldest = recentIds.keys().next().value;
      if (oldest === undefined) break;
      recentIds.delete(oldest);
    }
  }
  return false;
}

/**
 * Bound how many relay sockets exist at once.
 *
 * The relay allows 50 concurrent connections per IP and the bridge is one IP,
 * so an unbounded burst would lock the bridge out of the relay entirely. This
 * is approximate — single-threaded, so a slot can occasionally be double-taken
 * on resume — which is fine for a ceiling well under the real one.
 */
const MAX_CONCURRENT_SOCKETS = 8;
const SLOT_WAIT_MS = 5_000;
let activeSockets = 0;
const slotWaiters: Array<() => void> = [];

async function acquireSlot(): Promise<boolean> {
  if (activeSockets < MAX_CONCURRENT_SOCKETS) { activeSockets += 1; return true; }
  const granted = await new Promise<boolean>((resolve) => {
    const waiter = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => {
      const at = slotWaiters.indexOf(waiter);
      if (at >= 0) slotWaiters.splice(at, 1);
      resolve(false);
    }, SLOT_WAIT_MS);
    slotWaiters.push(waiter);
  });
  if (granted) activeSockets += 1;
  return granted;
}

function releaseSlot(): void {
  activeSockets = Math.max(0, activeSockets - 1);
  slotWaiters.shift()?.();
}

/** Publish one already-verified event, returning the relay's own verdict. */
export async function publishToRelay(
  event: BridgeEvent,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; message: string }> {
  if (!(await acquireSlot())) {
    return { ok: false, message: "the bridge is busy — try again shortly" };
  }
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(relayServerUrl()); }
    catch { releaseSlot(); return resolve({ ok: false, message: "could not reach the relay" }); }

    let settled = false;
    const done = (result: { ok: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseSlot();
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
export async function queryRelay(
  filters: unknown[],
  timeoutMs = 10_000,
): Promise<{ ok: boolean; events: BridgeEvent[]; message: string }> {
  if (!(await acquireSlot())) {
    return { ok: false, events: [], message: "the bridge is busy — try again shortly" };
  }
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(relayServerUrl()); }
    catch { releaseSlot(); return resolve({ ok: false, events: [], message: "could not reach the relay" }); }

    const events: BridgeEvent[] = [];
    const subId = "bridge-" + Math.random().toString(36).slice(2, 10);
    let settled = false;
    const done = (result: { ok: boolean; events: BridgeEvent[]; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseSlot();
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
