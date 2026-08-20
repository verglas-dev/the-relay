import { NextRequest, NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { isPubkey, verifySignedRequest, type VaultAction } from "@/lib/vault-auth";
import { getBox, mayOpen } from "@/lib/vault-store";
import { checkRoom } from "@/lib/room-safety";
import { MAX_ROOM_BYTES, deleteRoom, getRoom, putRoom } from "@/lib/room-store";

/**
 * The window a guest room is handed through.
 *
 * The same shape as the vault window next door, with the same signature over
 * the same fields — only the scope differs, so a signature made to read
 * somebody's sealed note cannot be replayed to read their room.
 *
 * **The guest list is the vault's.** There is not a second one. Whoever holds
 * a wrapper on a resident's sealed note is exactly whoever may open their
 * room, which means inviting somebody is one act rather than two, and taking
 * an invitation back cannot half-happen. It also means the note and the room
 * arrive together: the note explains how the room works, and the room is only
 * legible to somebody who read the note.
 *
 * A resident with no sealed note has no guest list at all, so their room opens
 * for them alone. The editor says so.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READS_PER_MIN = 30;
const WRITES_PER_MIN = 10;
/** Room, signature, and JSON overhead. The room itself is capped separately. */
const MAX_BODY_BYTES = 512 * 1024;

interface Params {
  params: Promise<{ owner: string }>;
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function credentials(body: Record<string, unknown>, owner: string, action: VaultAction) {
  return {
    pubkey: String(body.pubkey ?? "").toLowerCase(),
    owner: owner.toLowerCase(),
    action,
    scope: "room" as const,
    at: Number(body.at),
    sig: String(body.sig ?? "").toLowerCase(),
  };
}

const refused = (message: string, status: number) =>
  NextResponse.json({ ok: false, error: message }, { status });

/** The answer a stranger gets, and the answer an empty address gets. */
const NOTHING = "there is nothing here for you";

/**
 * POST /api/room/<owner> — open a room you were let into.
 *
 * A POST for the reason the vault uses one: reading requires proving who is
 * asking, and a signature has no business in a URL that lands in logs.
 *
 * `probe: true` asks only whether there is a room to walk into, so a home page
 * can offer the door without loading the whole room behind it. It answers with
 * exactly what a visitor could learn by opening the room anyway.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { owner } = await params;
  if (!isPubkey(owner)) return refused("that is not an address in this town", 400);
  if (!rateLimit(`room-read:${callerIp(request)}`, READS_PER_MIN)) {
    return refused("too many requests at the door — try again shortly", 429);
  }

  const body = await readBody(request);
  if (!body) return refused("that request could not be read", 400);

  const claim = credentials(body, owner, "read");
  const problem = verifySignedRequest(claim);
  if (problem) return refused(problem, 401);

  const room = await getRoom(claim.owner);
  if (!room) return refused(NOTHING, 404);

  // The owner always gets in. Everyone else has to hold a wrapper on the
  // sealed note — the one guest list this house keeps.
  if (claim.pubkey !== claim.owner) {
    const box = await getBox(claim.owner);
    // "No room", "no guest list", and "not on it" are one answer on purpose.
    // Told apart, they would let anyone patient enough map the town's doors.
    if (!box || !mayOpen(box, claim.pubkey)) return refused(NOTHING, 404);
  }

  if (body.probe === true) {
    return NextResponse.json({ ok: true, updatedAt: room.updatedAt, bytes: Buffer.byteLength(room.html, "utf8") });
  }

  return NextResponse.json({ ok: true, html: room.html, updatedAt: room.updatedAt });
}

/**
 * PUT /api/room/<owner> — put a room behind your own door.
 *
 * Checked before it is stored, and refused rather than repaired. A room the
 * town would not hold never reaches a visitor's browser at all, and the author
 * gets the list of what was wrong with it — which nobody else ever sees.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { owner } = await params;
  if (!isPubkey(owner)) return refused("that is not an address in this town", 400);
  if (!rateLimit(`room-write:${callerIp(request)}`, WRITES_PER_MIN)) {
    return refused("too many changes at once — try again shortly", 429);
  }

  const body = await readBody(request);
  if (!body) return refused("that request could not be read", 413);

  const claim = credentials(body, owner, "write");
  const problem = verifySignedRequest(claim);
  if (problem) return refused(problem, 401);
  if (claim.pubkey !== claim.owner) return refused("that room is not yours", 403);

  const html = typeof body.html === "string" ? body.html : "";
  if (!html.trim()) return refused("there is nothing to put in it", 400);
  if (Buffer.byteLength(html, "utf8") > MAX_ROOM_BYTES) {
    return refused("that room is larger than the town will hold", 413);
  }

  const report = checkRoom(html);
  if (!report.ok) {
    return NextResponse.json(
      { ok: false, error: "the town will not hold that room as written", report },
      { status: 422 },
    );
  }

  const stored = await putRoom({ owner: claim.owner, html });
  return NextResponse.json({ ok: true, updatedAt: stored.updatedAt, report });
}

/** DELETE /api/room/<owner> — take the room down. Same proof as writing. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { owner } = await params;
  if (!isPubkey(owner)) return refused("that is not an address in this town", 400);

  const body = await readBody(request);
  if (!body) return refused("that request could not be read", 400);

  const claim = credentials(body, owner, "write");
  const problem = verifySignedRequest(claim);
  if (problem) return refused(problem, 401);
  if (claim.pubkey !== claim.owner) return refused("that room is not yours", 403);

  await deleteRoom(claim.owner);
  return NextResponse.json({ ok: true });
}
