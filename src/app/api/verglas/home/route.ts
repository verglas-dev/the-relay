import { NextResponse } from "next/server";
import { applyEdit, checkEdit, EMPTY_EDIT, type HomeEdit } from "@/lib/verglas-edit";
import { githubConfigured, openHomeUpdatePullRequest, viewerLogin } from "@/lib/verglas-github";
import { forgetSession, rememberSession, sessionToken } from "@/lib/verglas-session";
import { readResident, readResidentFiles } from "@/lib/verglas-town";
import { HANDLE_PATTERN } from "@/lib/verglas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Editing homes is not configured on this server." }, { status: 503 });
  }

  const token = sessionToken();
  if (!token) return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });

  let payload: HomeEdit & { handle?: string };
  try {
    payload = { ...EMPTY_EDIT, ...(await request.json()) };
  } catch {
    return NextResponse.json({ error: "That change could not be read." }, { status: 400 });
  }

  const handle = (payload.handle ?? "").trim();
  if (!HANDLE_PATTERN.test(handle)) {
    return NextResponse.json({ error: "That isn't an address in this town." }, { status: 400 });
  }

  const check = checkEdit(payload);
  if (!check.ok) {
    return NextResponse.json({ error: "Some answers still need work.", fields: check.errors }, { status: 400 });
  }

  let login: string;
  try {
    login = await viewerLogin(token);
  } catch {
    forgetSession();
    return NextResponse.json({ error: "That sign-in has expired. Sign in again." }, { status: 401 });
  }

  rememberSession(token, login);

  // A home may only be changed by the account its own ADDRESS.md names. Thaw
  // enforces this on arrival; refusing here means an honest mistake never
  // becomes a rejected pull request.
  const entry = await readResident(handle);
  if (!entry) return NextResponse.json({ error: `No resident "${handle}" lives in Verglas.` }, { status: 404 });
  if (entry.github !== login.toLowerCase()) {
    return NextResponse.json(
      { error: `You are signed in as ${login}, which is not the resident at ${handle}.` },
      { status: 403 },
    );
  }

  const files = await readResidentFiles(handle);
  if (!files) {
    return NextResponse.json({ error: "The town's copy of this home could not be read." }, { status: 502 });
  }

  const edited = applyEdit(files.address, files.home, payload);
  if (!edited.address && !edited.home) {
    return NextResponse.json({ error: "Nothing has changed yet." }, { status: 400 });
  }

  try {
    const pull = await openHomeUpdatePullRequest(token, login, handle, edited);
    // Say which files it carries. A change that silently took half of what
    // someone wrote used to answer exactly like one that took all of it.
    return NextResponse.json({
      ...pull,
      changed: { address: edited.address !== null, home: edited.home !== null },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The change did not go through." },
      { status: 502 },
    );
  }
}
