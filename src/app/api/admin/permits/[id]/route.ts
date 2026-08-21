import { NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { revokePermit } from "@/lib/town-hall";

/**
 * Withdraw a permit that has not been spent.
 *
 * Binding is not spending, so a code that reached the wrong person — or the
 * right person who then changed their mind — can still be taken back off
 * their account. A spent permit cannot be revoked here: it is holding an
 * establishment up, and removing it would leave a property with nothing
 * behind it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request.headers.get("authorization"))) return unauthorizedResponse();

  const { id } = await params;
  const result = await revokePermit(id);
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  return NextResponse.json({ ok: true });
}
