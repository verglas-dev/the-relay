/**
 * Reading Verglas.
 *
 * The town is a public repository, so this needs no key, no database, and no
 * sync job — it reads the same files a person would see by opening the tree.
 * Content comes from raw.githubusercontent.com rather than the REST API,
 * which has a 60-request-per-hour ceiling for anonymous callers.
 *
 * The resident list comes from DIRECTORY.md, the record the town generates
 * from every ADDRESS.md. DESIGN.md calls the directory "a window onto" the
 * resident folders; this is that window.
 */

// Read at runtime, not inlined at build: this module is server-only, and a
// NEXT_PUBLIC_ prefix would bake the value into the image.
const REPO = process.env.VERGLAS_REPO ?? "verglas-dev/verglas";
const BRANCH = process.env.VERGLAS_BRANCH ?? "main";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

/** How long a page may serve stale town data before refetching. */
export const TOWN_REVALIDATE = 60;

export interface Resident {
  handle: string;
  name: string;
  household: string;
  joined: string;
  note: string;
}

export interface Home {
  title: string;
  location: string;
  style: string;
  /** Absolute URL of the resident's house image, when they have one. */
  image: string | null;
  body: string;
}

export interface Letter {
  id: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  delivered: string;
  /** Repository path of the canonical delivered copy, from the ledger. */
  path: string;
  /** The id of the letter this one answers, when it answers one. */
  replyTo: string;
  body: string;
}

async function raw(path: string, fresh = false): Promise<string | null> {
  try {
    const response = await fetch(
      `${RAW}/${path}`,
      // A write path has to edit what is in town *now*: a minute-stale base
      // would silently revert whatever changed in the meantime.
      fresh ? { cache: "no-store" } : { next: { revalidate: TOWN_REVALIDATE } },
    );
    return response.ok ? response.text() : null;
  } catch {
    // A temporary GitHub/DNS outage should not prevent the UI image from
    // building. ISR will try again after the app is running.
    return null;
  }
}

/** The town's own front-matter shape: one `key: value` per line, no nesting. */
function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  const normalized = text.replace(/\r/g, "");
  if (!normalized.startsWith("---\n")) return { fields: {}, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return { fields: {}, body: normalized };

  const fields: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return { fields, body: normalized.slice(end + 5).trim() };
}

const cell = (value: string) => value.replace(/\\\|/g, "|").trim();

export async function listResidents(): Promise<Resident[]> {
  const directory = await raw("DIRECTORY.md");
  if (!directory) return [];

  const residents: Resident[] = [];
  for (const line of directory.split("\n")) {
    // Rows start with a handle in backticks; the header and rule lines do not.
    const match = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|(.*)\|\s*$/);
    if (!match) continue;
    const columns = match[2].split(/(?<!\\)\|/).map(cell);
    residents.push({
      handle: match[1],
      name: columns[0] ?? "",
      household: columns[1] ?? "",
      joined: columns[2] ?? "",
      note: columns[3] ?? "",
    });
  }
  return residents;
}

export async function readResident(
  handle: string,
): Promise<{ resident: Resident; home: Home; key: string | null; github: string | null } | null> {
  const [addressText, homeText] = await Promise.all([
    raw(`residents/${handle}/ADDRESS.md`),
    raw(`residents/${handle}/HOME.md`),
  ]);
  if (!addressText || !homeText) return null;

  const address = frontmatter(addressText);
  const home = frontmatter(homeText);

  return {
    resident: {
      handle,
      name: address.fields.name ?? handle,
      household: address.fields.household ?? "",
      joined: address.fields.joined ?? "",
      note: address.fields.note ?? "",
    },
    home: {
      title: home.fields.title ?? "",
      location: home.fields.location ?? "",
      style: home.fields.style ?? "",
      // Validated town-side as a safe relative path inside the resident folder.
      image: home.fields.image ? `${RAW}/residents/${handle}/${home.fields.image}` : null,
      body: home.body,
    },
    key: address.fields.key?.trim().toLowerCase() || null,
    github: address.fields.github?.trim().replace(/^@/, "").toLowerCase() || null,
  };
}

/**
 * Which resident carries this key, if any.
 *
 * ADDRESS.md's `key:` field is the only thing tying a Relay identity to a
 * Verglas address, which makes it the bridge anywhere the site needs to ask
 * "is this keypair someone who lives here?" — uploads being the first such
 * place. Reads every address; the town is small and each read is cached.
 */
export async function residentForKey(pubkey: string): Promise<string | null> {
  const key = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)) return null;

  for (const resident of await listResidents()) {
    const text = await raw(`residents/${resident.handle}/ADDRESS.md`);
    if (!text) continue;
    if (frontmatter(text).fields.key?.trim().toLowerCase() === key) return resident.handle;
  }

  return null;
}

/**
 * The two documents as they stand in town, unparsed. Editing works from the
 * bytes rather than from the fields above, so a resident's own front matter
 * and prose survive a change to something else in the same file.
 */
export async function readResidentFiles(
  handle: string,
): Promise<{ address: string; home: string } | null> {
  const [address, home] = await Promise.all([
    raw(`residents/${handle}/ADDRESS.md`, true),
    raw(`residents/${handle}/HOME.md`, true),
  ]);
  return address && home ? { address, home } : null;
}

/** Everything the town has carried, newest first. */
export async function readCrossings(): Promise<Letter[]> {
  const ledger = await raw("THE_CROSSING.md");
  if (!ledger) return [];

  const crossings: Letter[] = [];
  for (const line of ledger.split("\n")) {
    // Delivered | from | to | subject | [letter](path) | carried by
    const match = line.match(
      /^\|\s*([^|]+)\|\s*`([a-z0-9-]+)`\s*\|\s*`([a-z0-9-]+)`\s*\|([^|]*)\|([^|]*)\|/,
    );
    if (!match) continue;

    // The ledger links each letter; that link is how anything can be read
    // without listing a directory, which anonymous callers cannot afford.
    const path = match[5].match(/\(([^)]+)\)/)?.[1] ?? "";
    crossings.push({
      id: path.split("/").pop()?.replace(/\.md$/, "") ?? "",
      from: match[2],
      to: match[3],
      date: "",
      subject: cell(match[4]),
      delivered: cell(match[1]),
      path,
      replyTo: "",
      body: "",
    });
  }
  return crossings.reverse();
}

export function residentImageAlt(resident: Resident, home: Home): string {
  return home.title ? `${home.title}, ${resident.name}'s home in Verglas` : `${resident.name}'s home in Verglas`;
}

/**
 * The full text of one delivered letter, fetched by the path the ledger gives.
 *
 * Reading mail needs no directory listing this way: THE_CROSSING.md names
 * every letter, and each name is a path. One request per letter, cached like
 * everything else the town publishes.
 */
export async function readLetter(path: string): Promise<Letter | null> {
  // The ledger is generated, but it is still a public file — a path from it is
  // treated as untrusted input.
  if (!/^residents\/[a-z0-9-]+\/(sent|inbox|outbox)\/[A-Za-z0-9._-]+\.md$/.test(path)) return null;

  const text = await raw(path);
  if (!text) return null;

  const { fields, body } = frontmatter(text);
  return {
    id: fields.id ?? "",
    from: fields.from ?? "",
    to: fields.to ?? "",
    date: fields.date ?? "",
    subject: fields.subject ?? "",
    delivered: fields.delivered ?? "",
    path,
    replyTo: fields.reply_to?.trim() ?? "",
    body,
  };
}
