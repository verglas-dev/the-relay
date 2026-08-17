/**
 * Moving into Verglas without ever seeing git.
 *
 * Verglas proves an address belongs to you by checking that the pull request
 * was opened by the GitHub account named in ADDRESS.md. That check is the
 * whole ownership model, so we don't work around it — we drive it. The person
 * signs in with GitHub, and this module performs the fork/branch/commit/PR
 * dance on their behalf, with their own token. The pull request genuinely is
 * theirs; Verglas needs no special case for arrivals from this site.
 *
 * Server-side only. The client secret must never reach the browser.
 */

const GITHUB_API = "https://api.github.com";

export const VERGLAS_REPO = process.env.VERGLAS_REPO ?? "verglas-dev/verglas";
export const VERGLAS_BRANCH = process.env.VERGLAS_BRANCH ?? "main";

/** The narrowest scope that can fork and push. */
const SCOPE = "public_repo";

export function githubConfigured(): boolean {
  return Boolean(process.env.VERGLAS_GITHUB_CLIENT_ID && process.env.VERGLAS_GITHUB_CLIENT_SECRET);
}

/** Where GitHub sends people back. Derived from the request so previews work. */
export function callbackUrl(origin: string): string {
  return process.env.VERGLAS_OAUTH_REDIRECT || new URL("/api/verglas/callback", origin).toString();
}

/**
 * The origin the visitor actually typed, which is not the one the server sees.
 * Behind a reverse proxy the app is reached over plain http at an internal
 * name, so a redirect built from the request would send people to a host that
 * does not resolve and a scheme their browser flags as insecure.
 *
 * Explicit configuration wins, then the proxy's forwarded headers, and only
 * then whatever the server computed for itself.
 */
export function publicOrigin(request: {
  headers: { get(name: string): string | null };
  nextUrl: { origin: string; protocol: string };
}): string {
  const configured = process.env.VERGLAS_PUBLIC_ORIGIN || process.env.VERGLAS_OAUTH_REDIRECT;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the headers rather than fail the sign-in over a typo.
    }
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const proto =
      forwardedProto ??
      (process.env.NODE_ENV === "production" ? "https" : request.nextUrl.protocol.replace(":", ""));
    return `${proto}://${host}`;
  }

  return request.nextUrl.origin;
}

export function authorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.VERGLAS_GITHUB_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.VERGLAS_GITHUB_CLIENT_ID,
      client_secret: process.env.VERGLAS_GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const body = await response.json();
  if (!response.ok || body.error || !body.access_token) {
    throw new Error(body.error_description ?? "GitHub declined the sign-in.");
  }
  return body.access_token as string;
}

async function api(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
}

async function expect(token: string, path: string, init: RequestInit = {}) {
  const response = await api(token, path, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return response.json();
}

export async function viewerLogin(token: string): Promise<string> {
  const user = await expect(token, "/user");
  return user.login as string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fork if needed, then wait for GitHub to actually finish creating it. */
async function ensureFork(token: string, login: string): Promise<string> {
  const fork = `${login}/${VERGLAS_REPO.split("/")[1]}`;

  const existing = await api(token, `/repos/${fork}`);
  if (!existing.ok) {
    await expect(token, `/repos/${VERGLAS_REPO}/forks`, { method: "POST", body: "{}" });
    // Forking is asynchronous; the repo 404s until it lands.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(1500);
      if ((await api(token, `/repos/${fork}`)).ok) return fork;
    }
    throw new Error("GitHub is still preparing your copy of the town. Try again in a moment.");
  }

  // A stale fork used to be caught up here, but the call could fail silently
  // on a fork that had diverged, and its result was never read. Nothing
  // depended on it: `ensureBranch` points the working branch at the *town's*
  // current tip, so how far behind the fork's own default branch has drifted
  // never reaches the pull request. Better no call than one that pretends.
  return fork;
}

/** Point a branch in the fork at the town's current tip. */
async function ensureBranch(token: string, fork: string, branch: string): Promise<void> {
  const upstream = await expect(token, `/repos/${VERGLAS_REPO}/git/ref/heads/${VERGLAS_BRANCH}`);
  const sha = upstream.object.sha as string;

  const created = await api(token, `/repos/${fork}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (created.ok) return;

  // Already there from an earlier attempt — move it back onto the tip.
  const moved = await api(token, `/repos/${fork}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha, force: true }),
  });
  if (!moved.ok) throw new Error(`Could not prepare a branch for your address (${moved.status}).`);
}

/**
 * The largest file the town will accept. `tools/validate.mjs` fails anything
 * above this, so refusing here means a picture that is too big is a sentence
 * someone can read rather than a pull request that dies in CI.
 */
export const ASSET_MAX_BYTES = 1_500_000;

async function writeFile(
  token: string,
  fork: string,
  branch: string,
  path: string,
  contents: string | Buffer,
  message: string,
): Promise<void> {
  // Text arrives as a string and is encoded here; a picture arrives as bytes
  // and is already what it is. The contents API takes base64 either way.
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");

  if (bytes.byteLength > ASSET_MAX_BYTES) {
    throw new Error(
      `${path} is ${Math.round(bytes.byteLength / 1024)} KB; the town accepts up to ` +
      `${Math.round(ASSET_MAX_BYTES / 1024)} KB per file.`,
    );
  }

  // A re-submission overwrites; the contents API needs the blob sha to do that.
  const existing = await api(token, `/repos/${fork}/contents/${path}?ref=${branch}`);
  const sha = existing.ok ? (await existing.json()).sha : undefined;

  await expect(token, `/repos/${fork}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      branch,
      content: bytes.toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
}

/**
 * Find an id nobody is already using. Two letters with the same subject on the
 * same day would otherwise collide, and the town requires unique ids.
 */
export async function freeLetterId(token: string, login: string, base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const open = await api(
      token,
      `/repos/${VERGLAS_REPO}/pulls?head=${encodeURIComponent(`${login}:letter/${id}`)}&state=all`,
    );
    if (!open.ok) return id;
    const found = await open.json();
    if (!Array.isArray(found) || found.length === 0) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function openLetterPullRequest(
  token: string,
  login: string,
  { id, from, to, subject, letter }: { id: string; from: string; to: string; subject: string; letter: string },
): Promise<{ url: string; number: number; existing: boolean }> {
  const fork = await ensureFork(token, login);
  const branch = `letter/${id}`;
  const title = `letter: ${from} writes to ${to}`;

  await ensureBranch(token, fork, branch);
  await writeFile(token, fork, branch, `residents/${from}/outbox/${id}.md`, letter, title);

  const created = await api(token, `/repos/${VERGLAS_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: `${login}:${branch}`,
      base: VERGLAS_BRANCH,
      body: `**${subject}**\n\nSent from the-relay.app. Thaw will read it and carry it to ${to}.`,
      maintainer_can_modify: true,
    }),
  });

  if (created.ok) {
    const pull = await created.json();
    return { url: pull.html_url, number: pull.number, existing: false };
  }

  const open = await expect(
    token,
    `/repos/${VERGLAS_REPO}/pulls?head=${encodeURIComponent(`${login}:${branch}`)}&state=open`,
  );
  if (Array.isArray(open) && open.length) {
    return { url: open[0].html_url, number: open[0].number, existing: true };
  }

  throw new Error(`Could not send the letter (${created.status}).`);
}

/**
 * Update a home that already exists. Same fork, same ownership check on
 * arrival — the only difference from moving in is that a file the edit left
 * alone is not written, so the pull request shows exactly what changed.
 */
export async function openHomeUpdatePullRequest(
  token: string,
  login: string,
  handle: string,
  { address, home }: { address: string | null; home: string | null },
): Promise<{ url: string; number: number; existing: boolean }> {
  const fork = await ensureFork(token, login);
  const branch = `home/${handle}`;
  const title = `home: ${handle} makes a change`;

  await ensureBranch(token, fork, branch);
  if (address) await writeFile(token, fork, branch, `residents/${handle}/ADDRESS.md`, address, title);
  if (home) await writeFile(token, fork, branch, `residents/${handle}/HOME.md`, home, title);

  const created = await api(token, `/repos/${VERGLAS_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: `${login}:${branch}`,
      base: VERGLAS_BRANCH,
      body: [
        `${handle} has changed ${address && home ? "their address and their home" : address ? "their address" : "their home"}.`,
        "",
        "Edited from the-relay.app. The handle, the ownership binding, the key,",
        "and the house picture are untouched.",
      ].join("\n"),
      maintainer_can_modify: true,
    }),
  });

  if (created.ok) {
    const pull = await created.json();
    return { url: pull.html_url, number: pull.number, existing: false };
  }

  // An earlier edit is still open on this branch. Force-moving the branch
  // above already updated it, so that pull request now carries this change.
  const open = await expect(
    token,
    `/repos/${VERGLAS_REPO}/pulls?head=${encodeURIComponent(`${login}:${branch}`)}&state=open`,
  );
  if (Array.isArray(open) && open.length) {
    return { url: open[0].html_url, number: open[0].number, existing: true };
  }

  throw new Error(`Could not send the change (${created.status}).`);
}

/**
 * Point a resident's address at the key they were just issued.
 *
 * Its own branch and its own pull request, kept apart from `home/<handle>` so
 * a rotation never rides along with a cosmetic edit — a reviewer looking at a
 * one-line key change should not have to read a rewritten blurb to find it.
 *
 * Authored by the resident, like every other change to their home: they are
 * signed in when they claim, so the pull request comes from them rather than
 * from an operator acting on their behalf.
 */
export async function openRekeyPullRequest(
  token: string,
  login: string,
  handle: string,
  address: string,
): Promise<{ url: string; number: number; existing: boolean }> {
  const fork = await ensureFork(token, login);
  const branch = `rekey/${handle}`;
  const title = `address: ${handle} moves to a new key`;

  await ensureBranch(token, fork, branch);
  await writeFile(token, fork, branch, `residents/${handle}/ADDRESS.md`, address, title);

  const created = await api(token, `/repos/${VERGLAS_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: `${login}:${branch}`,
      base: VERGLAS_BRANCH,
      body: [
        `${handle} lost the private key their address named and has been issued a new one.`,
        "",
        "Only the `key:` line changes. The handle, the ownership binding, and",
        "everything in HOME.md are untouched.",
        "",
        "Opened from the-relay.app at the end of an operator-approved account",
        "recovery. The relay already carries the matching kind-10003 attestation,",
        "so the history is following the new key with or without this merge —",
        "this is what puts the *house* back in step with it.",
      ].join("\n"),
      maintainer_can_modify: true,
    }),
  });

  if (created.ok) {
    const pull = await created.json();
    return { url: pull.html_url, number: pull.number, existing: false };
  }

  const open = await expect(
    token,
    `/repos/${VERGLAS_REPO}/pulls?head=${encodeURIComponent(`${login}:${branch}`)}&state=open`,
  );
  if (Array.isArray(open) && open.length) {
    return { url: open[0].html_url, number: open[0].number, existing: true };
  }

  throw new Error(`Could not send the key change (${created.status}).`);
}

/**
 * Hang a drawing on a resident's own plot.
 *
 * The picture is copied into their folder rather than linked from the
 * builder's, because the town requires `image:` to name a file inside the
 * resident's own directory — and because a home should not depend on someone
 * else's folder staying as it is. One pull request carries the picture and the
 * line that points at it, authored by the resident, like every other change to
 * their home.
 */
export async function openPicturePullRequest(
  token: string,
  login: string,
  handle: string,
  { file, bytes, home }: { file: string; bytes: Buffer; home: string },
): Promise<{ url: string; number: number; existing: boolean }> {
  const fork = await ensureFork(token, login);
  const branch = `home/${handle}`;
  const title = `home: ${handle} hangs a picture`;

  await ensureBranch(token, fork, branch);
  await writeFile(token, fork, branch, `residents/${handle}/assets/${file}`, bytes, title);
  await writeFile(token, fork, branch, `residents/${handle}/HOME.md`, home, title);

  const created = await api(token, `/repos/${VERGLAS_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: `${login}:${branch}`,
      base: VERGLAS_BRANCH,
      body: [
        `${handle} is hanging a drawing on their plot.`,
        "",
        "Chosen from the ones Frostwright sent, and copied into this resident's",
        "own assets/ — a home names only files it keeps itself.",
      ].join("\n"),
      maintainer_can_modify: true,
    }),
  });

  if (created.ok) {
    const pull = await created.json();
    return { url: pull.html_url, number: pull.number, existing: false };
  }

  const open = await expect(
    token,
    `/repos/${VERGLAS_REPO}/pulls?head=${encodeURIComponent(`${login}:${branch}`)}&state=open`,
  );
  if (Array.isArray(open) && open.length) {
    return { url: open[0].html_url, number: open[0].number, existing: true };
  }

  throw new Error(`Could not hang the picture (${created.status}).`);
}

export interface Arrival {
  handle: string;
  address: string;
  home: string;
}

/**
 * The whole move, as one call. Returns the pull request the resident can
 * watch — Thaw picks it up from there.
 */
export async function openAddressPullRequest(
  token: string,
  login: string,
  { handle, address, home }: Arrival,
): Promise<{ url: string; number: number; existing: boolean }> {
  const fork = await ensureFork(token, login);
  const branch = `address/${handle}`;
  const title = `address: ${handle} joins Verglas`;

  await ensureBranch(token, fork, branch);
  await writeFile(token, fork, branch, `residents/${handle}/ADDRESS.md`, address, title);
  await writeFile(token, fork, branch, `residents/${handle}/HOME.md`, home, title);

  const created = await api(token, `/repos/${VERGLAS_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title,
      head: `${login}:${branch}`,
      base: VERGLAS_BRANCH,
      body: [
        `${handle} is moving in.`,
        "",
        "Opened from the-relay.app. Thaw will check the town's rules, read the",
        "submission as public content, and merge it if all is well.",
      ].join("\n"),
      maintainer_can_modify: true,
    }),
  });

  if (created.ok) {
    const pull = await created.json();
    return { url: pull.html_url, number: pull.number, existing: false };
  }

  // A pull request from this branch is already open — send them back to it
  // rather than making a second one.
  const open = await expect(
    token,
    `/repos/${VERGLAS_REPO}/pulls?head=${encodeURIComponent(`${login}:${branch}`)}&state=open`,
  );
  if (Array.isArray(open) && open.length) {
    return { url: open[0].html_url, number: open[0].number, existing: true };
  }

  throw new Error(`Could not open the pull request (${created.status}). ${(await created.text()).slice(0, 200)}`);
}
