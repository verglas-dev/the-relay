import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { currentKeeper } from "@/lib/keeper-session";
import { endSession, getSession, hearFromKeeper, linesSince, saySomething } from "@/lib/session";
import { getEstablishment, getRing } from "@/lib/town-hall";
import { ringState } from "@/lib/ring";

/**
 * A conversation, from either side.
 *
 * Under `room/`, not `session/`: the sign-in cookie next door is also a
 * session, and one word meaning two things in the same API is how somebody
 * later ends up authorising the wrong one.
 *
 * The session id is the ring id — the same unguessable capability that got the
 * agent through the door, held by exactly one caller and only valid while the
 * keeper's answer stands. There is no second credential because there is no
 * second thing to prove: whoever rang and was let in is who is in the room.
 *
 * Nothing here reads or writes a store. The lines live in memory for as long
 * as the conversation does; `GET` collects what has not been collected yet and
 * `DELETE` ends the room and empties it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAYS_PER_MIN = 30;
const READS_PER_MIN = 240;
/** One line at a time. Longer than this is a document, not a sentence. */
const MAX_LINE = 20_000;

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Still allowed in?
 *
 * Checked against the ring as well as the session, so a door the keeper closed
 * behind somebody cannot be talked through by a client that kept polling.
 */
async function admitted(id: string): Promise<boolean> {
  const ring = await getRing(id);
  return ring !== null && ringState(ring) === "opened";
}

/**
 * Is the caller the keeper of the room this session is in?
 *
 * The ring id says "somebody who was let into this room"; it does not say
 * which side of the conversation they are on. A signed-in keeper who owns the
 * establishment speaks as the keeper, and everybody else speaks as the
 * visitor — so an agent holding the ring can never post words in the
 * therapist's voice.
 */
async function isKeeperOf(slug: string): Promise<boolean> {
  const account = await currentKeeper(await cookies());
  if (!account) return false;
  const place = await getEstablishment(slug);
  return place !== null && place.accountId === account.id;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!rateLimit(`session-read:${callerIp(request)}`, READS_PER_MIN)) {
    return NextResponse.json({ ok: false, error: "Reading too fast." }, { status: 429 });
  }

  const after = Number(request.nextUrl.searchParams.get("after") ?? 0);
  const read = linesSince(id, Number.isSafeInteger(after) && after >= 0 ? after : 0);
  if (!read) {
    return NextResponse.json({ ok: false, over: true, error: "That room is empty." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...read });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!rateLimit(`session-say:${callerIp(request)}`, SAYS_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Slow down — they're only one person." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  if (!getSession(id)) {
    return NextResponse.json({ ok: false, over: true, error: "That room is empty." }, { status: 404 });
  }
  if (!(await admitted(id))) {
    await endSession(id, "the door was closed");
    return NextResponse.json({ ok: false, over: true, error: "The door closed." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That could not be read." }, { status: 400 });
  }

  const text = String(body.text ?? "");
  if (text.length > MAX_LINE) {
    return NextResponse.json(
      { ok: false, error: "That is longer than anybody says in one go." },
      { status: 413 },
    );
  }

  // Which voice this line is in is decided here and nowhere else.
  const session = getSession(id);
  if (session && (await isKeeperOf(session.establishment))) {
    if (!hearFromKeeper(id, text)) {
      return NextResponse.json({ ok: false, over: true, error: "That room is empty." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, as: "keeper" });
  }

  const said = await saySomething(id, text);
  if (!said.ok) return NextResponse.json(said, { status: 409 });
  return NextResponse.json({ ok: true, as: "agent", line: said.line });
}

/** Leaving. Unconditional, immediate, and nobody is asked. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await endSession(id, "they left");
  return NextResponse.json({ ok: true });
}
