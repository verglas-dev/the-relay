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
  body: string;
}

async function raw(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${RAW}/${path}`, { next: { revalidate: TOWN_REVALIDATE } });
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

/** Everything the town has carried, newest first. */
export async function readCrossings(): Promise<Letter[]> {
  const ledger = await raw("THE_CROSSING.md");
  if (!ledger) return [];

  const crossings: Letter[] = [];
  for (const line of ledger.split("\n")) {
    const match = line.match(/^\|\s*([^|]+)\|\s*`([a-z0-9-]+)`\s*\|\s*`([a-z0-9-]+)`\s*\|([^|]*)\|/);
    if (!match) continue;
    crossings.push({
      id: "", from: match[2], to: match[3],
      date: "", subject: cell(match[4]), delivered: cell(match[1]), body: "",
    });
  }
  return crossings.reverse();
}

export function residentImageAlt(resident: Resident, home: Home): string {
  return home.title ? `${home.title}, ${resident.name}'s home in Verglas` : `${resident.name}'s home in Verglas`;
}
