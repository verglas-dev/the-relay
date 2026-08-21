import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { doorStatus } from "@/lib/establishment-hours";
import { currentKeeper } from "@/lib/keeper-session";
import { ringState } from "@/lib/ring";
import { endSession, sessionAt } from "@/lib/session";
import { establishmentsFor, ringsFor } from "@/lib/town-hall";

/**
 * Who has been at the keeper's doors.
 *
 * The keeper's own page polls this. It carries what the store holds and no
 * more — who rang, when, and whether the door was answered. There is no
 * conversation to return, by construction.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await currentKeeper(await cookies());
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const places = await establishmentsFor(account.id);
  const doors = await Promise.all(
    places.map(async (place) => ({
      slug: place.slug,
      name: place.name,
      status: doorStatus(place),
      presence: place.presence,
      presenceUntil: place.presenceUntil,
      // Whether a bell is wired, never which one. The topic is a credential.
      wired: place.bell !== null,
      // Somebody in the room right now, and whether they ever actually
      // arrived. The second half matters: an unvisited room is a door the
      // keeper opened for nobody, and they should be able to see that rather
      // than wonder why their own bell says occupied.
      occupiedBy: (() => {
        const live = sessionAt(place.slug);
        return live
          ? { who: live.visitorLabel, arrived: live.arrived, since: live.startedAt, ring: live.id }
          : null;
      })(),
      rings: (await ringsFor(place.slug)).slice(0, 20).map((ring) => ({
        id: ring.id,
        handle: ring.handle,
        pubkey: ring.pubkey.slice(0, 8),
        rungAt: ring.rungAt,
        state: ringState(ring),
        answeredAt: ring.answeredAt,
        delivered: ring.delivered,
      })),
    })),
  );

  return NextResponse.json({ ok: true, doors });
}


/**
 * End whatever visit is in progress.
 *
 * The keeper's own escape hatch. A room can be held by somebody who never
 * turned up — a notification tapped by accident, an agent whose page closed —
 * and waiting out a timer to use your own establishment is not a reasonable
 * ask. Ending a real conversation is also a thing a keeper is allowed to do.
 */
export async function DELETE(request: Request) {
  const account = await currentKeeper(await cookies());
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase() ?? "";
  const mine = (await establishmentsFor(account.id)).some((place) => place.slug === slug);
  if (!mine) return NextResponse.json({ ok: false, error: "That is not your establishment." }, { status: 404 });

  const live = sessionAt(slug);
  if (!live) return NextResponse.json({ ok: true, says: "Nobody is in there." });

  await endSession(live.id, "the keeper ended the visit");
  return NextResponse.json({ ok: true, says: "The room is empty again." });
}
