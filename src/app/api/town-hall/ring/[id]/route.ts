import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { currentKeeper } from "@/lib/keeper-session";
import { publicRing } from "@/lib/ring";
import { answerRing, getRing } from "@/lib/town-hall";
import { openRoom } from "@/lib/session-open";
import { sweepSessions } from "@/lib/session";

/**
 * Answering the door, and waiting to hear.
 *
 * `POST` is pressed twice from two very different places: a button on the
 * keeper's lock screen, which carries a secret and no session, and the
 * keeper's own page, which carries a session and no secret. Either is enough;
 * the store checks both and refuses identically.
 *
 * `GET` is the agent waiting outside. The ring id is unguessable and was handed
 * to exactly one caller, so it is the capability — and all it discloses is
 * whether the door opened, which is the thing they are standing there to find
 * out.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECKS_PER_IP_PER_MIN = 120;

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!rateLimit(`ring-check:${callerIp(request)}`, CHECKS_PER_IP_PER_MIN)) {
    return NextResponse.json({ ok: false, error: "Checking too fast." }, { status: 429 });
  }

  const ring = await getRing(id);
  if (!ring) return NextResponse.json({ ok: false, error: "There is no such ring." }, { status: 404 });

  return NextResponse.json({ ok: true, ring: publicRing(ring) });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const choice = request.nextUrl.searchParams.get("answer");
  if (choice !== "opened" && choice !== "declined") {
    return NextResponse.json({ ok: false, error: "Open the door, or don't." }, { status: 400 });
  }

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const keeper = bearer ? null : await currentKeeper(await cookies());

  const result = await answerRing({
    id,
    answer: choice,
    answerKey: bearer,
    accountId: keeper?.id,
  });
  if (!result.ok) return NextResponse.json(result, { status: 409 });

  // Opportunistic: rooms that went quiet get closed whenever somebody
  // answers a door, rather than by a timer nothing owns.
  void sweepSessions();

  // Opening the door starts the conversation. A failure here is reported but
  // does not un-open the door — the room and its terminal still work, and the
  // keeper is better off being told their channel is down than being told
  // nothing happened.
  let trouble: string | undefined;
  if (choice === "opened") {
    const opened = await openRoom(result.ring);
    if (!opened.ok) trouble = opened.error;
  }

  // ntfy renders the response body of an action button in a toast, so this is
  // written to be read on a lock screen rather than parsed.
  return NextResponse.json({
    ok: true,
    ring: publicRing(result.ring),
    says:
      choice === "declined"
        ? "They've been told, kindly."
        : trouble
          ? `The door is open, but ${trouble}`
          : "The door is open. Check your notifications for the room.",
  });
}
