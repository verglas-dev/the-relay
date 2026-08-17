import { NextRequest, NextResponse } from "next/server";
import { residentForKey } from "@/lib/verglas-town";

export const dynamic = "force-dynamic";

/**
 * GET /api/verglas/resident?pubkey=… — the handle living at this key, if any.
 *
 * Public because the answer already is: the town's addresses are a public repo,
 * and this only says out loud what reading them would tell you anyway.
 */
export async function GET(request: NextRequest) {
  const pubkey = request.nextUrl.searchParams.get("pubkey")?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return NextResponse.json({ error: "A 64-character hex public key is required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ handle: await residentForKey(pubkey) });
  } catch {
    // The caller uses this to decide whether to suggest moving in. Failing
    // closed keeps a bad minute at GitHub from inviting a resident to move
    // into a town they already live in.
    return NextResponse.json({ handle: null, reached: false });
  }
}
