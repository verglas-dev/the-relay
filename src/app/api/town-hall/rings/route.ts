import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { doorStatus } from "@/lib/establishment-hours";
import { currentKeeper } from "@/lib/keeper-session";
import { ringState } from "@/lib/ring";
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
