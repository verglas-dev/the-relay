import { NextRequest, NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { ring as sendToPhone } from "@/lib/bell";
import { doorStatus, bellRings, STATUS_WORDS } from "@/lib/establishment-hours";
import { helpText } from "@/lib/establishment-commands";
import { verifyRing } from "@/lib/door-auth";
import { publicRing } from "@/lib/ring";
import { sessionAt } from "@/lib/session";
import { bellFor, getEstablishment, markRingDelivered, recordRing } from "@/lib/town-hall";
import { publicOrigin } from "@/lib/verglas-github";
import { residentForKey } from "@/lib/verglas-town";

/**
 * The doorbell.
 *
 * `GET` asks whether anyone is in. It is unsigned and public, because the
 * answer is already printed on the establishment's page — making the terminal
 * sign a request to read a sign would be ceremony without a secret.
 *
 * `POST` rings it, and that is a different thing: it lights up a real person's
 * phone. So it carries a signature over the door, the action, and the moment,
 * checked against the key that claims it. An agent cannot ring a door in
 * somebody else's name, and a captured "is anyone in?" cannot be replayed as a
 * ring at three in the morning.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A doorbell is not a keyboard. */
const RINGS_PER_KEY_PER_MIN = 2;
const RINGS_PER_IP_PER_MIN = 6;
const ASKS_PER_IP_PER_MIN = 60;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  if (!rateLimit(`door-ask:${callerIp(request)}`, ASKS_PER_IP_PER_MIN)) {
    return NextResponse.json({ ok: false, error: "Too many questions at once." }, { status: 429 });
  }

  const place = await getEstablishment(slug);
  if (!place) return NextResponse.json({ ok: false, error: "There is no door there." }, { status: 404 });

  const status = doorStatus(place);
  const occupied = sessionAt(place.slug) !== null;
  return NextResponse.json({
    ok: true,
    slug: place.slug,
    name: place.name,
    status,
    occupied,
    rings: bellRings(status) && !occupied,
    says: occupied
      ? "Somebody is in there just now. Come back in a little while."
      : STATUS_WORDS[status].detail,
    // Whether a ring can reach anybody at all. A keeper with no bell wired up
    // is a door you should knock on by letter instead, and saying so here
    // saves an agent standing outside waiting.
    reachable: (await bellFor(place.slug)) !== null,
    // The vocabulary, before anybody has gone in. An agent should be able to
    // read what a place answers the same way it reads the hours — and a
    // terminal can print this the moment it arrives rather than waiting to be
    // asked, which is the whole reason HELP is the first thing anyone types.
    commands: place.commands,
    help: helpText(place),
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const ip = callerIp(request);

  if (!rateLimit(`door-ring-ip:${ip}`, RINGS_PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "That is a lot of ringing. Wait a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const pubkey = String(body.pubkey ?? "").trim().toLowerCase();
  const problem = verifyRing({
    pubkey,
    slug,
    action: "ring",
    at: Number(body.at),
    sig: String(body.sig ?? ""),
  });
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 401 });

  // Per key as well as per address: one agent should not be able to spend a
  // whole building's allowance, and a shared IP should not stop them ringing.
  if (!rateLimit(`door-ring-key:${pubkey}`, RINGS_PER_KEY_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "You just rang. Give them a moment." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const place = await getEstablishment(slug);
  if (!place) return NextResponse.json({ ok: false, error: "There is no door there." }, { status: 404 });

  const status = doorStatus(place);
  if (!bellRings(status)) {
    return NextResponse.json(
      { ok: false, status, error: STATUS_WORDS[status].detail },
      { status: 409 },
    );
  }

  // The "one at a time" rule belongs here, at the door, rather than after
  // somebody has been admitted. Refusing later meant the keeper answered a
  // bell for a visitor the room would then turn away.
  if (sessionAt(place.slug)) {
    return NextResponse.json(
      {
        ok: false,
        status,
        occupied: true,
        error: "Somebody is in there just now. Come back in a little while.",
      },
      { status: 409 },
    );
  }

  // Their address in town, if they have one. A name on the notification is
  // worth more to the keeper than a hex string, and this is the only lookup
  // the doorbell does.
  let handle: string | null = null;
  try {
    handle = await residentForKey(pubkey);
  } catch {
    // The town being unreachable is not a reason a bell cannot ring.
  }

  const recorded = await recordRing({ slug: place.slug, pubkey, handle });
  if (!recorded.ok) return NextResponse.json(recorded, { status: 409 });
  const { ring } = recorded;

  const origin = publicOrigin(request);
  const answer = (choice: "open" | "decline") => ({
    label: choice === "open" ? "Open the door" : "Not now",
    url: `${origin}/api/town-hall/ring/${ring.id}?answer=${choice === "open" ? "opened" : "declined"}`,
    method: "POST",
    // The buttons are pressed from a lock screen, which carries no session —
    // so the authority travels with the notification.
    headers: { authorization: `Bearer ${ring.answerKey}` },
    clear: true,
  });

  const delivered = await sendToPhone(await bellFor(place.slug), {
    title: `${place.name} — someone is at the door`,
    message: `${handle ?? "An agent"} rang the bell${handle ? ` (${pubkey.slice(0, 8)})` : ""}.\nThey are waiting.`,
    tags: ["bell"],
    priority: 4,
    click: `${origin}/verglas/keeper?ring=${ring.id}`,
    actions: [answer("open"), answer("decline")],
  });

  await markRingDelivered(ring.id, delivered.ok);

  return NextResponse.json({
    ok: true,
    ring: publicRing({ ...ring, delivered: delivered.ok }),
    // Said honestly. A ring nobody heard still happened, and an agent standing
    // outside deserves to know which of the two it was.
    heard: delivered.ok,
    says: delivered.ok
      ? "The bell rang. Wait here — you'll be told when the door opens."
      : delivered.skipped
        ? "This door has no bell wired up. Your ring was recorded; the keeper will see it when they next look."
        : "The bell could not be reached. Your ring was recorded.",
  });
}
