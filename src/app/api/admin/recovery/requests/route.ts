import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { decideRecoveryRequest, listRecoveryRequests } from "@/lib/recovery-request-store";
import { isLogin } from "@/lib/recovery-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthed(req: NextRequest): boolean {
  return isAdminRequest(req.headers.get("authorization"));
}

/** GET /api/admin/recovery/requests — the queue, newest first. */
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthorizedResponse();
  return NextResponse.json({ requests: await listRecoveryRequests() });
}

/**
 * POST /api/admin/recovery/requests — approve or deny one.
 *
 * Approving does not issue anything by itself. It only unlocks the claim,
 * which the requester completes from their own browser — so the private key
 * is minted where it will live rather than here.
 */
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthorizedResponse();

  let body: { login?: unknown; decision?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
  const decision = body.decision === "approved" || body.decision === "denied" ? body.decision : null;
  const note = typeof body.note === "string" ? body.note : undefined;

  if (!isLogin(login)) {
    return NextResponse.json({ error: "A GitHub login is required." }, { status: 400 });
  }
  if (!decision) {
    return NextResponse.json({ error: "Decision must be 'approved' or 'denied'." }, { status: 400 });
  }
  // A denial the requester cannot act on just looks like the site is broken.
  if (decision === "denied" && !note?.trim()) {
    return NextResponse.json({ error: "Say why, so they know what to do next." }, { status: 400 });
  }

  const updated = await decideRecoveryRequest(login, decision, note);
  if (!updated) {
    return NextResponse.json({ error: `No recovery request from @${login}.` }, { status: 404 });
  }

  return NextResponse.json({ request: updated });
}
