import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { endSession, sessionAt } from "@/lib/session";
import { demolishEstablishment } from "@/lib/town-hall";

/**
 * Taking a place down.
 *
 * The fast path for a permit that reached the wrong person. Everything this
 * does was already possible by stopping the stack and editing JSON in a
 * container — this only means it takes one request instead of a maintenance
 * window at the moment you are most annoyed.
 *
 *   DELETE /api/admin/establishments/<slug>            the place
 *   DELETE /api/admin/establishments/<slug>?keeper=1   the place and its owner
 *
 * The permit stays spent either way. Handing it back would turn "one
 * establishment per permit" into "unlimited, with extra steps".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAdminRequest(request.headers.get("authorization"))) return unauthorizedResponse();

  const { slug } = await params;
  const alsoKeeper = ["1", "true", "yes"].includes(
    (request.nextUrl.searchParams.get("keeper") ?? "").toLowerCase(),
  );

  // Anybody standing in the room is shown out first. Demolishing the door
  // around somebody mid-conversation would leave them talking to a place that
  // no longer exists, and the keeper's phone still listening.
  const live = sessionAt(slug);
  if (live) await endSession(live.id, "the room was closed by the town");

  const result = await demolishEstablishment({ slug, alsoKeeper });
  if (!result.ok) return NextResponse.json(result, { status: 404 });

  return NextResponse.json({
    ok: true,
    removed: result.removed,
    says:
      `${result.removed.name} is gone, and ${result.removed.slug} is free again.` +
      (result.removed.accountRemoved ? " Its keeper's account went with it." : "") +
      " The permit it cost stays spent.",
  });
}
