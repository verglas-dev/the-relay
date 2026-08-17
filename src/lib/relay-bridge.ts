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
const QUERY_FILTER_KEYS = new Set(["ids", "authors", "kinds", "since", "until", "limit"]);

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

/**
 * Open a relay socket, naming the caller it is being opened for.
 *
 * Without this every bridged request reaches the relay wearing this server's
 * container address, so all bridge users share one per-IP bucket there and one
 * heavy caller exhausts it for the rest. Naming the caller gives each their own
 * allowance, the same as if they had opened the socket themselves.
 *
 * The relay believes this header only from addresses in its TRUSTED_PROXY_IPS,
 * which is why setting it here is safe: it is the same claim nginx makes for
 * browsers, made by the same kind of trusted hop. A relay that has not been
 * told to trust this container ignores it and falls back to the old behaviour.
 */
function relaySocket(onBehalfOf?: string): WebSocket {
  const headers =
    onBehalfOf && onBehalfOf !== "unknown" ? { "X-Real-IP": onBehalfOf } : undefined;
  return new WebSocket(relayServerUrl(), { headers });
}

/** Structural check. Returns an error string, or null when the event is well-formed. */
export function validateEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return "event must be an object";
  const e = event as Record<string, unknown>;

  if (typeof e.id !== "string" || !HEX64.test(e.id)) return "id must be 64 lowercase hex chars";
  if (typeof e.pubkey !== "string" || !HEX64.test(e.pubkey)) return "pubkey must be 64 lowercase hex chars";
  if (typeof e.sig !== "string" || !HEX128.test(e.sig)) return "sig must be 128 lowercase hex chars";
  if (typeof e.kind !== "number" || !Number.isInteger(e.kind) || e.kind < 0 || e.kind > 65535) {
    return "kind must be an integer from 0 to 65535";
  }
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

/**
 * Validate filters before the bridge opens a relay socket.
 *
 * The relay repeats these checks at its own trust boundary. Keeping the early
 * copy here gives HTTPS callers an immediate 400 and prevents malformed input
 * from spending a shared socket or REQ token.
 */
export function validateQueryFilters(
  filters: unknown[],
  options: { maxFilters?: number; maxLimit?: number; maxValues?: number } = {},
): string | null {
  const maxFilters = options.maxFilters ?? 5;
  const maxLimit = options.maxLimit ?? 200;
  const maxValues = options.maxValues ?? 500;

  if (filters.length === 0 || filters.length > maxFilters) {
    return `supply between 1 and ${maxFilters} filters`;
  }

  let valueCount = 0;
  for (const [index, candidate] of filters.entries()) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return `filter ${index + 1} must be an object`;
    }
    const filter = candidate as Record<string, unknown>;
    let hasSelector = false;

    for (const [key, value] of Object.entries(filter)) {
      if (!QUERY_FILTER_KEYS.has(key) && !key.startsWith("#")) {
        return `filter ${index + 1} has unsupported field ${key}`;
      }
      if (key === "limit") {
        if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maxLimit) {
          return `filter ${index + 1} limit must be an integer from 1 to ${maxLimit}`;
        }
        continue;
      }
      if (key === "since" || key === "until") {
        if (!Number.isSafeInteger(value) || (value as number) < 0) {
          return `filter ${index + 1} ${key} must be a non-negative integer`;
        }
        hasSelector = true;
        continue;
      }
      if (key.startsWith("#")) {
        if (key.length === 1 || key.length > 65) return `filter ${index + 1} has an invalid tag field`;
        if (!Array.isArray(value) || value.length === 0) {
          return `filter ${index + 1} ${key} must be a non-empty string array`;
        }
        if (value.some((entry) => typeof entry !== "string" || entry.length > MAX_TAG_VALUE_LEN)) {
          return `filter ${index + 1} ${key} values must be strings of at most ${MAX_TAG_VALUE_LEN} characters`;
        }
        valueCount += value.length;
        hasSelector = true;
        continue;
      }
      if (!Array.isArray(value) || value.length === 0) {
        return `filter ${index + 1} ${key} must be a non-empty array`;
      }
      if (key === "kinds") {
        if (value.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry > 65535)) {
          return `filter ${index + 1} kinds must contain integers from 0 to 65535`;
        }
      } else if (value.some((entry) => typeof entry !== "string" || !HEX64.test(entry))) {
        return `filter ${index + 1} ${key} must contain 64-character lowercase hex values`;
      }
      valueCount += value.length;
      hasSelector = true;
    }

    if (
      typeof filter.since === "number" &&
      typeof filter.until === "number" &&
      filter.since > filter.until
    ) {
      return `filter ${index + 1} since must not exceed until`;
    }
    if (!hasSelector) return `filter ${index + 1} needs at least one selector`;
  }

  return valueCount > maxValues
    ? `too many selector values (max ${maxValues})`
    : null;
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

// How long a caller may take to finish sending its body. A request that has
// not delivered a few kilobytes in this long is not a slow network, it is a
// client holding a handler open — the classic slowloris shape.
const BODY_READ_TIMEOUT_MS = 10_000;

/**
 * Read a JSON body with a hard ceiling on both size and time.
 *
 * The size cap matches the relay's own 64 KB frame limit: a body larger than
 * that could never be forwarded anyway. `Content-Length` is checked first when
 * it is offered, but it is a claim rather than a fact, so the decoded text is
 * measured too.
 *
 * The time cap matters because a caller can simply omit `Content-Length` and
 * trickle bytes, occupying a handler for as long as the runtime allows —
 * Node's default request timeout is five minutes. A reverse proxy that buffers
 * request bodies (nginx does by default) absorbs this before it ever reaches
 * the app, so this is depth rather than the only defense; it is what protects
 * the app when it is reached directly.
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
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) =>
      { timeoutId = setTimeout(() => reject(new Error("body-timeout")), BODY_READ_TIMEOUT_MS); },
    );
    text = await Promise.race([request.text(), timeout]);
  } catch (error) {
    if (error instanceof Error && error.message === "body-timeout") {
      return { ok: false, status: 408, error: "took too long to send the request body" };
    }
    return { ok: false, status: 400, error: "could not read request body" };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
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

export function acceptedRecently(id: string): boolean {
  const now = Date.now();
  const at = recentIds.get(id);
  if (at !== undefined && now - at < RECENT_ID_TTL) return true;
  if (at !== undefined) recentIds.delete(id);
  return false;
}

/** Remember only a relay-confirmed acceptance; failed deliveries must remain retryable. */
export function rememberAccepted(id: string): void {
  const now = Date.now();
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
  onBehalfOf?: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(await acquireSlot())) {
    return { ok: false, message: "the bridge is busy — try again shortly" };
  }
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = relaySocket(onBehalfOf); }
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
  onBehalfOf?: string,
): Promise<{ ok: boolean; complete: boolean; events: BridgeEvent[]; message: string; status: number }> {
  if (!(await acquireSlot())) {
    return { ok: false, complete: false, events: [], message: "the bridge is busy — try again shortly", status: 503 };
  }
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = relaySocket(onBehalfOf); }
    catch {
      releaseSlot();
      return resolve({ ok: false, complete: false, events: [], message: "could not reach the relay", status: 502 });
    }

    const events: BridgeEvent[] = [];
    const subId = "bridge-" + Math.random().toString(36).slice(2, 10);
    let settled = false;
    const done = (result: { ok: boolean; complete: boolean; events: BridgeEvent[]; message: string; status: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseSlot();
      try { ws.close(); } catch { /* already closing */ }
      resolve(result);
    };
    // A timeout may return a useful partial page, but must not claim that an
    // empty partial response proves there were no matches.
    const timer = setTimeout(() => done({
      ok: events.length > 0,
      complete: false,
      events,
      message: "partial: relay did not send EOSE in time",
      status: events.length > 0 ? 206 : 504,
    }), timeoutMs);

    ws.on("open", () => ws.send(JSON.stringify(["REQ", subId, ...filters])));
    ws.on("message", (raw: Buffer) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === "EVENT" && msg[1] === subId) events.push(msg[2] as BridgeEvent);
      if (msg[0] === "EOSE" && msg[1] === subId) {
        done({ ok: true, complete: true, events, message: "", status: 200 });
      }
      if (msg[0] === "NOTICE") {
        const message = String(msg[1] ?? "relay notice");
        const limited = message.startsWith("rate limited") || message.startsWith("rate-limited");
        done({ ok: false, complete: false, events, message, status: limited ? 429 : 502 });
      }
    });
    ws.on("error", () => done({
      ok: false, complete: false, events, message: "could not reach the relay", status: 502,
    }));
    ws.on("close", () => done({
      ok: events.length > 0,
      complete: false,
      events,
      message: "relay closed the connection",
      status: events.length > 0 ? 206 : 502,
    }));
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

/**
 * The caller's address, as reported by the proxy in front.
 *
 * `X-Real-IP` is preferred because it is the header this project's own nginx
 * config sets, from `$remote_addr`, which a caller cannot influence. It is
 * checked first deliberately: nginx forwards client headers it does not set
 * itself, so a config that sets only `X-Real-IP` passes through whatever
 * `X-Forwarded-For` the caller invented. Reading XFF first would take the
 * attacker's word over the proxy's.
 *
 * `X-Forwarded-For` remains the fallback for deployments fronted by something
 * that sets it instead — but it is only meaningful when the proxy overwrites
 * rather than appends:
 *
 *     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # appends — spoofable
 *     proxy_set_header X-Forwarded-For $remote_addr;                 # overwrites — trustworthy
 *
 * Either way, per-IP limiting is the outermost layer here and never the
 * load-bearing one. The per-key and global caps are enforced on values no
 * caller can choose, and hold whatever this function returns.
 */
export function callerIp(request: Request): string {
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
