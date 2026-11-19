import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { crossingFrom } from "@/lib/verglas-crossing";
import { GitHubAnswer, githubConfigured, letterCrossingFacts } from "@/lib/verglas-github";
import { sessionToken } from "@/lib/verglas-session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * GET /api/verglas/letter/status?number=… — where a letter is on its way.
 *
 * The page a letter was sent from asks this every few seconds until the
 * letter is delivered or closed. Everything it reads is public, but it's read
 * with the asker's own GitHub sign-in so that the town's visitors don't all
 * draw on one small anonymous allowance. Without a sign-in it says so, and
 * the page falls back to the link to GitHub.
 */
export async function GET(request: Request) {
  const number = Number(new URL(request.url).searchParams.get("number"));
  if (!Number.isSafeInteger(number) || number < 1) {
    return NextResponse.json({ error: "Which letter? Give its number." }, { status: 400, headers: NO_STORE });
  }
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Following letters is not configured on this server." }, { status: 503, headers: NO_STORE });
  }

  const token = sessionToken(await cookies());
  if (!token) {
    return NextResponse.json({ error: "Sign in with GitHub to follow it here." }, { status: 401, headers: NO_STORE });
  }

  try {
    const facts = await letterCrossingFacts(token, number);
    if (!facts) {
      return NextResponse.json({ error: `There is no letter numbered ${number}.` }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json(crossingFrom(facts), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GitHubAnswer && error.status === 401) {
      return NextResponse.json({ error: "That sign-in has expired. Sign in again to follow it here." }, { status: 401, headers: NO_STORE });
    }
    console.error("[verglas] could not follow a letter:", error);
    return NextResponse.json({ error: "GitHub didn't answer just now." }, { status: 502, headers: NO_STORE });
  }
}
