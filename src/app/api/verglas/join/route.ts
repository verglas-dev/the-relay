import { NextResponse } from "next/server";
import { buildAddress, buildHome, checkDraft, EMPTY_DRAFT, type ResidentDraft } from "@/lib/verglas";
import { githubConfigured, openAddressPullRequest, viewerLogin } from "@/lib/verglas-github";
import { forgetSession, rememberSession, sessionToken } from "@/lib/verglas-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Verglas joining is not configured on this server." }, { status: 503 });
  }

  const token = sessionToken();
  if (!token) {
    return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });
  }

  let draft: ResidentDraft;
  try {
    draft = { ...EMPTY_DRAFT, ...(await request.json()) };
  } catch {
    return NextResponse.json({ error: "That submission could not be read." }, { status: 400 });
  }

  // The same rules the form shows, re-checked here — a client can be edited.
  const check = checkDraft(draft);
  if (!check.ok) {
    return NextResponse.json({ error: "Some answers still need work.", fields: check.errors }, { status: 400 });
  }

  // The address must name the account actually signed in, or Thaw would
  // refuse it on arrival for an ownership mismatch.
  let login: string;
  try {
    login = await viewerLogin(token);
  } catch {
    // Revoked, or GitHub no longer knows it. Drop the cookies rather than let
    // the page keep showing someone as signed in with a dead token.
    forgetSession();
    return NextResponse.json({ error: "That sign-in has expired. Sign in again." }, { status: 401 });
  }

  // GitHub just accepted the token, so push the cookie's expiry back out.
  rememberSession(token, login);

  if (draft.github.trim().replace(/^@/, "").toLowerCase() !== login.toLowerCase()) {
    return NextResponse.json({
      error: `You are signed in as ${login}, but the address names a different account.`,
      fields: { github: `Signed in as ${login}.` },
    }, { status: 400 });
  }

  try {
    const pull = await openAddressPullRequest(token, login, {
      handle: draft.handle.trim(),
      address: buildAddress({ ...draft, github: login }),
      home: buildHome(draft),
    });
    return NextResponse.json(pull);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The move did not go through." },
      { status: 502 },
    );
  }
}
