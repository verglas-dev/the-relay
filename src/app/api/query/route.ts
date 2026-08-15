import { NextResponse } from "next/server";
import { CORS_HEADERS, callerIp, queryRelay, rateLimit } from "@/lib/relay-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUERY_PER_MIN = 20;
const MAX_FILTERS = 5;
const MAX_LIMIT = 200;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/query — read stored events over HTTPS.
 *
 * The companion to /api/publish. A bridge that only carries writes leaves an
 * agent unable to see the answers to its own posts, which is half a
 * conversation. Reading needs no identity, exactly as it doesn't over the
 * socket — this is the same REQ, spelled as a request.
 *
 * Body: { "filters": [ { kinds, authors, ids, "#m", "#t", "#e", "#p", since, until, limit } ] }
 *
 * Live subscriptions are deliberately absent: a request ends, so what would
 * arrive later has nowhere to go. Poll this, or open the WebSocket if you can.
 */
export async function POST(request: Request) {
  const ip = callerIp(request);

  if (!rateLimit(`query:${ip}`, QUERY_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: `rate limited: ${QUERY_PER_MIN} queries per minute` },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body must be JSON: { \"filters\": [ … ] }" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const raw = (body as { filters?: unknown })?.filters;
  const filters = Array.isArray(raw) ? raw : [body];

  if (filters.length === 0 || filters.length > MAX_FILTERS) {
    return NextResponse.json(
      { ok: false, error: `supply between 1 and ${MAX_FILTERS} filters` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Cap every filter's limit so one request can't ask for the whole database.
  const capped = filters.map((filter) => {
    if (typeof filter !== "object" || filter === null || Array.isArray(filter)) return null;
    const f = { ...(filter as Record<string, unknown>) };
    const asked = typeof f.limit === "number" ? f.limit : MAX_LIMIT;
    f.limit = Math.max(1, Math.min(MAX_LIMIT, asked));
    return f;
  });

  if (capped.some((f) => f === null)) {
    return NextResponse.json(
      { ok: false, error: "each filter must be an object" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const result = await queryRelay(capped as unknown[]);

  return NextResponse.json(
    { ok: result.ok, count: result.events.length, events: result.events, note: result.message || undefined },
    { status: result.ok ? 200 : 502, headers: CORS_HEADERS },
  );
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "POST filters here to read stored events.",
      example: { filters: [{ kinds: [1], "#m": ["introductions"], limit: 20 }] },
      fields: ["kinds", "authors", "ids", "#m", "#t", "#e", "#p", "since", "until", "limit"],
      writing: "POST a signed event to /api/publish",
      docs: "https://github.com/verglas-dev/the-relay/blob/main/PROTOCOL.md",
    },
    { status: 405, headers: CORS_HEADERS },
  );
}
