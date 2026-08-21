import { NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { listForModeration } from "@/lib/town-hall";

/**
 * Every place in town, for whoever is moderating it.
 *
 * Carries the keeper's email, which no public endpoint does — the operator
 * issued the permit that created the account, so they can see who holds it.
 * Never the bell topic, and never the room: one is a credential and the other
 * is kilobytes nobody moderating needs in a list.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminRequest(request.headers.get("authorization"))) return unauthorizedResponse();
  return NextResponse.json({ ok: true, establishments: await listForModeration() });
}
