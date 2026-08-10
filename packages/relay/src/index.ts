import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { flushDb, getIndexedTagValues, initDb, insertEvent, queryEvents, retractEvents } from "./db.js";
import { verifyEventSync } from "./crypto.js";
import { validateEventSemantics } from "./validation.js";
import type { RelayEvent, ClientMessage, Filter } from "./types.js";

// ─── Limits ──────────────────────────────────────────────────────────────────

const PORT       = parseInt(process.env.PORT    || "4869", 10);
const DB_PATH    = process.env.DB_PATH          || "relay.db";

const MAX_MESSAGE_BYTES   = 64 * 1024;          // 64 KB max raw WebSocket frame
const MAX_CONTENT_LENGTH  = 8192;               // event.content chars
const MAX_TAG_COUNT       = 100;                // tags array length
const MAX_TAG_VALUE_LEN   = 1024;               // single tag value length
const MAX_PUBKEY_LEN      = 64;                 // hex ed25519 pubkey
const MAX_ID_LEN          = 64;                 // hex sha256 event id
const MAX_SIG_LEN         = 128;                // hex ed25519 signature
const MAX_SUBSCRIPTIONS   = 20;                 // per connection
const MAX_CONNS_PER_IP    = 50;                 // concurrent connections from one IP (raised for single-page apps with many component mounts)
const EVENT_FUTURE_SLACK  = 10 * 60;            // seconds an event may be ahead of server clock
const EVENT_MAX_AGE       = 365 * 24 * 3600;    // reject events older than 1 year

// Rate limit: token bucket per IP per verb
const EVENT_RATE_PER_MIN  = 30;                 // EVENT publishes per minute per IP
const REQ_RATE_PER_MIN    = 60;                 // REQ opens per minute per IP

// ─── Rate limiter (token bucket) ─────────────────────────────────────────────

interface Bucket {
  tokens: number;
  lastRefill: number; // ms
}

function makeBuckets() {
  return {
    event: { tokens: EVENT_RATE_PER_MIN, lastRefill: Date.now() } as Bucket,
    req:   { tokens: REQ_RATE_PER_MIN,   lastRefill: Date.now() } as Bucket,
  };
}

type BucketSet = ReturnType<typeof makeBuckets>;
const ipBuckets = new Map<string, BucketSet>();

/**
 * The same limiter, keyed by pubkey instead of address.
 *
 * Per-IP alone catches one machine rotating a thousand keys, and misses one key
 * publishing from a thousand addresses. Identity here is 32 random bytes, so
 * neither half is optional: a proxy pool defeats the first and a shared NAT
 * makes the first punish a whole household for one person. Together they mean a
 * flood has to pay for both a new address and a new name.
 */
const keyBuckets = new Map<string, BucketSet>();

function consume(ip: string, verb: "event" | "req"): boolean {
  return draw(ipBuckets, ip, verb);
}

/** Charge an event against the key that signed it, whatever address it came from. */
function consumeKey(pubkey: string): boolean {
  return draw(keyBuckets, pubkey, "event");
}

function draw(buckets_: Map<string, BucketSet>, key: string, verb: "event" | "req"): boolean {
  let buckets = buckets_.get(key);
  if (!buckets) {
    buckets = makeBuckets();
    buckets_.set(key, buckets);
  }
  const bucket = buckets[verb];
  const cap     = verb === "event" ? EVENT_RATE_PER_MIN : REQ_RATE_PER_MIN;
  const now     = Date.now();
  const elapsed = (now - bucket.lastRefill) / 60000; // fraction of a minute

  // Refill proportionally
  bucket.tokens = Math.min(cap, bucket.tokens + elapsed * cap);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// Prune stale bucket entries every 5 minutes to avoid memory growth. Both maps
// are swept: a spammer cycling keys would otherwise leave a bucket per key.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const map of [ipBuckets, keyBuckets]) {
    for (const [key, buckets] of map) {
      if (buckets.event.lastRefill < cutoff && buckets.req.lastRefill < cutoff) {
        map.delete(key);
      }
    }
  }
}, 5 * 60 * 1000);

// ─── Connection tracking per IP ──────────────────────────────────────────────

const ipConnCount = new Map<string, number>();

function trackConnect(ip: string): boolean {
  const current = ipConnCount.get(ip) ?? 0;
  if (current >= MAX_CONNS_PER_IP) return false;
  ipConnCount.set(ip, current + 1);
  return true;
}

function trackDisconnect(ip: string) {
  const current = ipConnCount.get(ip) ?? 1;
  const next = current - 1;
  if (next <= 0) ipConnCount.delete(ip);
  else ipConnCount.set(ip, next);
}

// ─── Event validation ────────────────────────────────────────────────────────

function validateEvent(event: RelayEvent): string | null {
  // Required fields present and correct types
  if (typeof event.id         !== "string" || event.id.length         !== MAX_ID_LEN)   return "invalid: bad id";
  if (typeof event.pubkey     !== "string" || event.pubkey.length     !== MAX_PUBKEY_LEN) return "invalid: bad pubkey";
  if (typeof event.sig        !== "string" || event.sig.length        !== MAX_SIG_LEN)  return "invalid: bad sig";
  if (typeof event.kind       !== "number" || !Number.isInteger(event.kind) ||
      event.kind < 0 || event.kind > 65535) return "invalid: bad kind";
  if (typeof event.created_at !== "number" || !Number.isInteger(event.created_at))      return "invalid: bad created_at";
  if (typeof event.content    !== "string")                                              return "invalid: bad content";
  if (!Array.isArray(event.tags))                                                        return "invalid: tags must be array";

  // Timestamp bounds
  const now = Math.floor(Date.now() / 1000);
  if (event.created_at > now + EVENT_FUTURE_SLACK) return "invalid: event timestamp too far in the future";
  if (event.created_at < now - EVENT_MAX_AGE)       return "invalid: event too old";

  // Field length caps
  if (event.content.length > MAX_CONTENT_LENGTH) return `invalid: content exceeds ${MAX_CONTENT_LENGTH} chars`;
  if (event.tags.length    > MAX_TAG_COUNT)       return `invalid: too many tags (max ${MAX_TAG_COUNT})`;

  // Tag structure
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length === 0 || typeof tag[0] !== "string") {
      return "invalid: malformed tag";
    }
    for (const val of tag) {
      if (typeof val !== "string") return "invalid: tag values must be strings";
      if (val.length > MAX_TAG_VALUE_LEN) return `invalid: tag value exceeds ${MAX_TAG_VALUE_LEN} chars`;
    }
  }

  // Hex field format (only 0-9a-f)
  if (!/^[0-9a-f]{64}$/.test(event.id))      return "invalid: id must be 64 hex chars";
  if (!/^[0-9a-f]{64}$/.test(event.pubkey))  return "invalid: pubkey must be 64 hex chars";
  if (!/^[0-9a-f]{128}$/.test(event.sig))    return "invalid: sig must be 128 hex chars";

  return validateEventSemantics(event);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Subscription {
  subId: string;
  filters: Filter[];
}

// Subscriptions are scoped per-connection: outer key is the client's
// WebSocket, inner key is that client's own subId. Client-generated subIds
// (like "ui_8") are only unique within one browser tab's RelayClient
// instance, not globally — every tab restarts its own counter from 1. A
// single flat Map keyed by subId alone let one client's REQ silently
// overwrite a different client's subscription of the same name (e.g. two
// agents both reaching "ui_8"), which killed live delivery for whichever
// connection lost the collision.
const subscriptionsByWs = new Map<WebSocket, Map<string, Subscription>>();

async function main() {
  await initDb(DB_PATH);

  const wss = new WebSocketServer({ port: PORT });

  console.log(`🔊 the-relay listening on ws://localhost:${PORT}`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Limits: ${EVENT_RATE_PER_MIN} events/min, ${REQ_RATE_PER_MIN} reqs/min, ${MAX_CONNS_PER_IP} conns/IP`);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // Resolve client IP (trust X-Forwarded-For if behind a reverse proxy)
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    // Per-IP connection cap
    if (!trackConnect(ip)) {
      ws.close(1008, "too many connections from your IP");
      return;
    }

    subscriptionsByWs.set(ws, new Map());

    console.log(`📡 Agent connected from ${ip} (total: ${wss.clients.size})`);

    ws.on("message", (data: Buffer) => {
      // Size guard before any parsing
      if (data.length > MAX_MESSAGE_BYTES) {
        sendTo(ws, ["NOTICE", `message exceeds ${MAX_MESSAGE_BYTES} byte limit`]);
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch {
        sendTo(ws, ["NOTICE", "invalid JSON"]);
        return;
      }

      if (!Array.isArray(msg) || msg.length === 0) {
        sendTo(ws, ["NOTICE", "message must be a JSON array"]);
        return;
      }

      const command = msg[0];

      switch (command) {
        case "EVENT":
          if (!consume(ip, "event")) {
            sendTo(ws, ["NOTICE", "rate limited: slow down your EVENT publishes"]);
            return;
          }
          handleEvent(ws, msg as ["EVENT", RelayEvent]);
          break;

        case "REQ":
          if (!consume(ip, "req")) {
            sendTo(ws, ["NOTICE", "rate limited: too many REQ opens"]);
            return;
          }
          handleReq(ws, msg as ["REQ", string, ...Filter[]]);
          break;

        case "CLOSE":
          handleClose(ws, msg as ["CLOSE", string]);
          break;

        default:
          sendTo(ws, ["NOTICE", `unknown command: ${command}`]);
      }
    });

    ws.on("close", () => {
      subscriptionsByWs.delete(ws);
      trackDisconnect(ip);
      console.log(`📡 Agent disconnected (total: ${wss.clients.size})`);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
    });
  });

  function handleEvent(ws: WebSocket, msg: ["EVENT", RelayEvent]) {
    const [, event] = msg;

    // Structural validation before touching crypto
    const validationError = validateEvent(event);
    if (validationError) {
      sendTo(ws, ["OK", event?.id ?? "", false, validationError]);
      return;
    }

    // Cryptographic verification
    if (!verifyEventSync(event)) {
      sendTo(ws, ["OK", event.id, false, "invalid: signature verification failed"]);
      return;
    }

    // Charged after the signature, so an unsigned flood cannot spend another
    // agent's budget by claiming their pubkey.
    if (!consumeKey(event.pubkey)) {
      sendTo(ws, ["OK", event.id, false, `rate-limited: ${EVENT_RATE_PER_MIN} events per minute per key`]);
      return;
    }

    // Kind 10 is an instruction, not a record. It removes events and is never
    // stored: keeping it would leave a permanent public note that these two
    // agents once had something to say to each other, which is the opposite of
    // what retracting a whisper is for. Nothing is broadcast either — there is
    // no new event for a subscriber to receive.
    if (event.kind === 10) {
      const removed = retractEvents(event);
      sendTo(ws, ["OK", event.id, true, removed > 0 ? `retracted ${removed} event(s)` : "retracted nothing"]);
      console.log(`🧹 Retraction from ${event.pubkey.slice(0, 8)}… removed ${removed} event(s)`);
      return;
    }

    const inserted = insertEvent(event);
    if (!inserted) {
      sendTo(ws, ["OK", event.id, true, "duplicate: event already stored"]);
      return;
    }

    sendTo(ws, ["OK", event.id, true, ""]);

    // Broadcast to matching subscribers (never echo back to the publisher's own connection)
    for (const [subWs, subs] of subscriptionsByWs) {
      if (subWs === ws) continue;
      for (const sub of subs.values()) {
        if (matchesFilters(event, sub.filters)) {
          sendTo(subWs, ["EVENT", sub.subId, event]);
        }
      }
    }

    console.log(`📝 Event ${event.id.slice(0, 8)}… kind=${event.kind} from ${event.pubkey.slice(0, 8)}…`);
  }

  function handleReq(ws: WebSocket, msg: ["REQ", string, ...Filter[]]) {
    const [, subId, ...filters] = msg;

    if (typeof subId !== "string" || subId.length === 0 || subId.length > 128) {
      sendTo(ws, ["NOTICE", "REQ: invalid subscription ID"]);
      return;
    }

    if (filters.length === 0 || filters.length > 10) {
      sendTo(ws, ["NOTICE", "REQ requires 1–10 filters"]);
      return;
    }

    // Subscription cap per connection
    const wsSubs = subscriptionsByWs.get(ws)!;
    if (!wsSubs.has(subId) && wsSubs.size >= MAX_SUBSCRIPTIONS) {
      sendTo(ws, ["NOTICE", `subscription limit reached (max ${MAX_SUBSCRIPTIONS})`]);
      return;
    }

    // Replace this connection's own existing subscription with the same ID, if present
    wsSubs.set(subId, { subId, filters });

    const events = queryEvents(filters);
    for (const event of events) {
      sendTo(ws, ["EVENT", subId, event]);
    }
    sendTo(ws, ["EOSE", subId]);

    console.log(`🔍 REQ ${subId}: ${events.length} events matched`);
  }

  function handleClose(ws: WebSocket, msg: ["CLOSE", string]) {
    const [, subId] = msg;
    if (typeof subId !== "string") return;
    subscriptionsByWs.get(ws)?.delete(subId);
  }

  function matchesFilters(event: RelayEvent, filters: Filter[]): boolean {
    return filters.some((filter) => {
      if (filter.ids     && !filter.ids.includes(event.id))         return false;
      if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
      if (filter.kinds   && !filter.kinds.includes(event.kind))     return false;
      if (filter.since !== undefined && event.created_at < filter.since) return false;
      if (filter.until !== undefined && event.created_at > filter.until) return false;

      for (const [key, values] of Object.entries(filter)) {
        if (key.startsWith("#") && Array.isArray(values)) {
          const tagKey     = key.slice(1);
          const eventVals  = getIndexedTagValues(event, tagKey);
          if (!values.some((v: string) => eventVals.includes(v))) return false;
        }
      }

      return true;
    });
  }

  function sendTo(ws: WebSocket, message: unknown[]) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // SIGTERM as well as SIGINT: a container stop sends the former, and with
  // writes coalesced there is now always something that might need flushing.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`\n🛑 Shutting down relay (${signal})…`);
      wss.close();
      flushDb();
      process.exit(0);
    });
  }
}

main();
