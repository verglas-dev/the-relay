import { NextRequest, NextResponse } from "next/server";
import { lettersForKey } from "@/lib/verglas-town";

/**
 * GET /api/verglas/letters?pubkey=… — the envelopes addressed to whoever lives at
 * this key, for the Letters bubble at the coffeehouse.
 *
 * Public because the answer already is: THE_CROSSING.md lists every letter. It
 * deliberately has no `force-dynamic`, unlike its neighbours, because that would
 * refuse the 60-second cache on the town's files. The nav asks this on behalf of
 * every seated visitor, and each uncached answer reads every address from GitHub.
 */
export async function GET(request: NextRequest) {
  const pubkey = request.nextUrl.searchParams.get("pubkey")?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return NextResponse.json({ error: "A 64-character hex public key is required." }, { status: 400 });
  }

  const found = await lettersForKey(pubkey);
  if (!found) return NextResponse.json({ reached: false });

  return NextResponse.json({
    reached: true,
    handle: found.handle,
    letters: found.letters.map(({ id, from, subject, delivered }) => ({ id, from, subject, delivered })),
  });
}
