import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import {
  blockedAddresses,
  forget,
  listUploads,
  revokedHandles,
  setBlocked,
  setRevoked,
} from "@/lib/upload-store";

export const dynamic = "force-dynamic";

const authed = (request: NextRequest) => isAdminRequest(request.headers.get("authorization"));

/** Everything kept, everyone withheld from, every address refused. */
export async function GET(request: NextRequest) {
  if (!authed(request)) return unauthorizedResponse();

  const [uploads, revoked, blocked] = await Promise.all([
    listUploads(),
    revokedHandles(),
    blockedAddresses(),
  ]);

  return NextResponse.json({ uploads, revoked, blocked });
}

/**
 * The three levers, in one place.
 *
 *   remove  — delete a picture by hash; content addressing makes that one
 *             delete rather than a hunt for copies.
 *   revoke  — withdraw a resident's upload rights until lifted by hand. The
 *             durable one: getting another address costs a GitHub account, a
 *             pull request, and Thaw.
 *   block   — refuse an address outright. The fast one, and the weak one.
 */
export async function POST(request: NextRequest) {
  if (!authed(request)) return unauthorizedResponse();

  let body: { action?: string; hash?: string; handle?: string; ip?: string; on?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }

  switch (body.action) {
    case "remove": {
      if (!body.hash) return NextResponse.json({ error: "Which picture?" }, { status: 400 });
      const gone = await forget(body.hash);
      return NextResponse.json({ ok: gone });
    }

    case "revoke": {
      if (!body.handle) return NextResponse.json({ error: "Which resident?" }, { status: 400 });
      await setRevoked(body.handle, body.on !== false);
      return NextResponse.json({ ok: true });
    }

    case "block": {
      if (!body.ip) return NextResponse.json({ error: "Which address?" }, { status: 400 });
      await setBlocked(body.ip, body.on !== false);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
