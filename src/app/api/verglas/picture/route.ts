import { NextResponse } from "next/server";
import { HANDLE_PATTERN } from "@/lib/verglas";
import { BUILDER } from "@/lib/verglas-commission";
import { splitDocument } from "@/lib/verglas-edit";
import { githubConfigured, openPicturePullRequest, viewerLogin, VERGLAS_BRANCH, VERGLAS_REPO } from "@/lib/verglas-github";
import { forgetSession, rememberSession, sessionToken } from "@/lib/verglas-session";
import { readResident, readResidentFiles } from "@/lib/verglas-town";
import { readOfferFor } from "@/lib/verglas-workbench";

export const dynamic = "force-dynamic";

/** The name a hung picture takes, whatever it was called in the workshop. */
const HUNG = "house";

/**
 * Hanging one of Frostwright's drawings.
 *
 * The builder cannot do this — a resident's folder opens only to them, which is
 * the rule that stops anyone redecorating someone else's house. So the picture
 * is copied here, under the resident's own account, in a pull request that is
 * genuinely theirs.
 *
 * The chosen file must be one they actually offered. Believing the client about
 * which file to fetch would turn this into a way to pull arbitrary paths out of
 * the repository and commit them somewhere else.
 */
export async function POST(request: Request) {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Hanging pictures is not configured on this server." }, { status: 503 });
  }

  const token = sessionToken();
  if (!token) return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });

  let payload: { handle?: string; file?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }

  const handle = (payload.handle ?? "").trim();
  const file = (payload.file ?? "").trim();
  if (!HANDLE_PATTERN.test(handle)) {
    return NextResponse.json({ error: "That isn't an address in this town." }, { status: 400 });
  }

  let login: string;
  try {
    login = await viewerLogin(token);
  } catch {
    forgetSession();
    return NextResponse.json({ error: "That sign-in has expired. Sign in again." }, { status: 401 });
  }
  rememberSession(token, login);

  const entry = await readResident(handle);
  if (!entry) return NextResponse.json({ error: `No resident "${handle}" lives in Verglas.` }, { status: 404 });
  if (entry.github !== login.toLowerCase()) {
    return NextResponse.json(
      { error: `You are signed in as ${login}, which is not the resident at ${handle}.` },
      { status: 403 },
    );
  }

  // The offer is the authority on what may be fetched. A filename that is not
  // in the letter they actually sent is refused, whatever the client claims.
  const offer = await readOfferFor(handle);
  if (!offer || !offer.drawings.includes(file)) {
    return NextResponse.json(
      { error: "That drawing isn't one of the ones offered to this home." },
      { status: 400 },
    );
  }

  const extension = file.split(".").pop()?.toLowerCase() ?? "png";
  const source = `https://raw.githubusercontent.com/${VERGLAS_REPO}/${VERGLAS_BRANCH}/residents/${BUILDER}/assets/${file}`;

  let bytes: Buffer;
  try {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return NextResponse.json(
      { error: "That drawing could not be fetched from the builder's workshop." },
      { status: 502 },
    );
  }

  const files = await readResidentFiles(handle);
  if (!files) {
    return NextResponse.json({ error: "The town's copy of this home could not be read." }, { status: 502 });
  }

  // Only the `image:` line changes; every other byte of HOME.md is left as the
  // resident wrote it.
  const home = splitDocument(files.home);
  if (!home.lines) {
    return NextResponse.json({ error: "This home's front matter could not be read." }, { status: 502 });
  }

  const target = `assets/${HUNG}.${extension}`;
  const at = home.lines.findIndex(line => line.key === "image");
  if (at === -1) home.lines.push({ raw: `image: ${target}`, key: "image" });
  else home.lines[at] = { raw: `image: ${target}`, key: "image" };

  const rebuilt = [
    "---",
    ...home.lines.map(line => line.raw),
    "---",
    "",
    ...(home.heading ? [home.heading, ""] : []),
    home.body,
    "",
  ].join("\n");

  try {
    const pull = await openPicturePullRequest(token, login, handle, {
      file: `${HUNG}.${extension}`,
      bytes,
      home: rebuilt,
    });
    return NextResponse.json({ ...pull, image: target });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The picture could not be hung." },
      { status: 502 },
    );
  }
}
