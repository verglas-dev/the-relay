import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { currentKeeper } from "@/lib/keeper-session";
import { buildRoom, roomBuilderConfigured } from "@/lib/room-builder";
import {
  approveRoomDraft,
  discardRoom,
  getEstablishment,
  roomsFor,
  setRoomDraft,
} from "@/lib/town-hall";

/**
 * Building the room, looking at it, and hanging it.
 *
 * Building costs a model call, so it is rate-limited harder than anything else
 * a keeper can do — and it never publishes. What comes back is a draft the
 * keeper stands in first; approving is a separate, free request.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Slow, expensive, and nobody needs to do it twice in a minute. */
const BUILDS_PER_MIN = 2;
/**
 * The model gets a while.
 *
 * A room drawn properly is tens of thousands of tokens of CSS and SVG, thought
 * about at full effort. A keeper presses this once and waits on purpose.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const account = await currentKeeper(await cookies());
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  const action = String(body.action ?? "build");

  if (action === "approve") {
    const result = await approveRoomDraft({ accountId: account.id, slug });
    if (!result.ok) return NextResponse.json(result, { status: 409 });
    return NextResponse.json({ ok: true, says: "The room is hung. Agents will stand in it." });
  }

  if (action === "discard" || action === "take-down") {
    const result = await discardRoom({
      accountId: account.id,
      slug,
      which: action === "discard" ? "draft" : "room",
    });
    if (!result.ok) return NextResponse.json(result, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (action !== "build") {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  if (!roomBuilderConfigured()) {
    return NextResponse.json(
      { ok: false, error: "This server cannot build rooms — no model is configured." },
      { status: 503 },
    );
  }

  if (!rateLimit(`room-build:${callerIp(request)}`, BUILDS_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Building a room takes a moment. Wait a minute before the next one." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const place = await getEstablishment(slug);
  if (!place || place.accountId !== account.id) {
    return NextResponse.json({ ok: false, error: "That is not your establishment." }, { status: 404 });
  }

  // A room is built from what the keeper already wrote. There is no separate
  // prompt box, on purpose: the description on the page and the room an agent
  // stands in should not be able to disagree with each other.
  const built = await buildRoom({
    name: place.name,
    kind: place.kind,
    location: place.location,
    about: place.about,
    offering: place.offering,
  });

  if (!built.ok) {
    return NextResponse.json(
      { ok: false, error: built.error, findings: built.findings },
      { status: 502 },
    );
  }

  const saved = await setRoomDraft({ accountId: account.id, slug, room: built.room });
  if (!saved.ok) return NextResponse.json(saved, { status: 409 });

  return NextResponse.json({
    ok: true,
    draft: built.room,
    cautions: built.cautions,
    says: "Have a look before anybody else does.",
  });
}

/** What is hung, and what is waiting to be looked at. */
export async function GET(request: Request) {
  const account = await currentKeeper(await cookies());
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase() ?? "";
  const rooms = await roomsFor({ accountId: account.id, slug });
  if (!rooms) return NextResponse.json({ ok: false, error: "That is not your establishment." }, { status: 404 });

  return NextResponse.json({ ok: true, ...rooms, configured: roomBuilderConfigured() });
}
