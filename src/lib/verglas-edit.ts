/**
 * Changing a home that already exists.
 *
 * Moving in writes two files from nothing, which is easy. Editing is the hard
 * direction: the files in town are the resident's, they may have been written
 * by hand or by an older version of this form, and they may carry fields this
 * site has never heard of. So nothing here regenerates a document — it edits
 * the one that is already there and leaves every byte it wasn't asked about
 * exactly where it was.
 *
 * Deliberately untouched, whatever the form sends:
 *
 *   handle, github, joined  the address's identity and ownership binding
 *   resident                HOME.md's back-reference to the folder
 *   key                     who can stand inside; rotating it is its own act
 *   image                   only a real file under assets/ may name itself here
 *
 * The handle is absent from this module for a reason. A folder rename is two
 * resident folders in one pull request, which the town rejects outright, and
 * it would orphan every letter that ever named the old address. An address is
 * the one thing in Verglas that cannot be taken back.
 *
 * Pure: no cookies, no fetch. The form and the route both check against this.
 */

import { NOTE_MAX, type DraftCheck } from "@/lib/verglas";

export interface HomeEdit {
  /** ADDRESS.md */
  name: string;
  household: string;
  note: string;
  /** ADDRESS.md prose, below the heading. */
  intro: string;
  /** HOME.md */
  title: string;
  location: string;
  style: string;
  /** HOME.md prose, below the heading. */
  home: string;
}

/**
 * What the town shows where a resident has written nothing. These are ours,
 * not theirs: a form that hands them back as if they were content invites
 * someone to submit a home whose description is the words "still being built",
 * and makes a lost edit impossible to spot.
 */
export const QUIET_DOORWAY = "_This doorway is still quiet._";
export const UNBUILT_HOME = "_This home is still being built._";

export const EMPTY_EDIT: HomeEdit = {
  name: "",
  household: "",
  note: "",
  intro: "",
  title: "",
  location: "",
  style: "",
  home: "",
};

export function checkEdit(edit: HomeEdit): DraftCheck {
  const errors: DraftCheck["errors"] = {};
  const warnings: DraftCheck["warnings"] = {};

  if (!edit.name.trim()) errors.name = "Who lives here?";
  if (!edit.household.trim()) errors.household = "Even a household of one needs a label.";
  if (!edit.title.trim()) errors.title = "Your home needs a name.";
  if (!edit.location.trim()) errors.location = "Where does it rest?";

  if (edit.note.trim().length > NOTE_MAX) {
    warnings.note = `${edit.note.trim().length} characters — the town prefers under ${NOTE_MAX}.`;
  }

  // Same nudge the move-in form gives: allowed, but it publishes a placeholder.
  if (!edit.intro.trim()) {
    warnings.intro = "Left blank, your doorway will read “This doorway is still quiet.”";
  }
  if (!edit.home.trim()) {
    warnings.home = "Left blank, your home will read “This home is still being built.”";
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}

/** One line of front matter, or a line this module refuses to interpret. */
interface Line {
  raw: string;
  key: string | null;
}

interface Document {
  /** Present only when the file opens with a front-matter block. */
  lines: Line[] | null;
  /** The `# Something` line, when the prose starts with one. */
  heading: string | null;
  /** Everything after the heading, trimmed of surrounding blank lines. */
  body: string;
}

const FIELD = /^([A-Za-z0-9_-]+):\s*(.*)$/;

/**
 * Split a resident document the same way the town's reader does: a leading
 * `---` block of one-line fields, then prose.
 */
export function splitDocument(text: string): Document {
  const normalized = text.replace(/\r/g, "");

  let lines: Line[] | null = null;
  let rest = normalized;

  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---\n", 4);
    if (end !== -1) {
      lines = normalized
        .slice(4, end)
        .split("\n")
        .map(raw => ({ raw, key: raw.match(FIELD)?.[1] ?? null }));
      rest = normalized.slice(end + 5);
    }
  }

  const prose = rest.replace(/^\n+/, "");

  let heading: string | null = null;
  let body = prose;
  if (prose.startsWith("# ")) {
    const firstBreak = prose.indexOf("\n");
    heading = firstBreak === -1 ? prose : prose.slice(0, firstBreak);
    body = firstBreak === -1 ? "" : prose.slice(firstBreak + 1);
  }

  return { lines, heading, body: body.replace(/^\n+/, "").replace(/\s+$/, "") };
}

export function field(doc: Document, key: string): string {
  const line = doc.lines?.find(entry => entry.key === key);
  return line ? (line.raw.match(FIELD)?.[2] ?? "").trim() : "";
}

/** Flatten onto one line — the town's reader takes everything after `key:`. */
function value(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Set, replace, or remove one field, leaving every other line untouched.
 *
 * `before` names the fields this one should sit above when it has to be
 * inserted, so a file edited here and a file written by the move-in form stay
 * recognisably the same document.
 */
function setField(
  lines: Line[],
  key: string,
  next: string,
  { optional = false, before = [] }: { optional?: boolean; before?: string[] } = {},
): void {
  const index = lines.findIndex(entry => entry.key === key);

  if (index !== -1) {
    // An optional field emptied out is removed rather than left hanging: the
    // town reads a blank field and a missing one alike, and a bare `note:`
    // looks like something went wrong.
    if (!next && optional) lines.splice(index, 1);
    else lines[index] = { raw: `${key}: ${next}`.trimEnd(), key };
    return;
  }

  if (!next) return;

  const anchor = before
    .map(name => lines.findIndex(entry => entry.key === name))
    .find(at => at !== -1);
  lines.splice(anchor ?? lines.length, 0, { raw: `${key}: ${next}`, key });
}

function render(doc: Document, heading: string | null, body: string, fallback: string): string {
  const parts: string[] = [];
  if (doc.lines) parts.push("---", ...doc.lines.map(line => line.raw), "---", "");
  if (heading) parts.push(heading, "");
  parts.push(body.trim() || fallback, "");
  return parts.join("\n");
}

export interface EditedFiles {
  address: string | null;
  home: string | null;
}

/**
 * Apply an edit to the two documents as they exist in town right now.
 *
 * Returns null for a file the edit leaves byte-identical, so a pull request
 * only ever carries what actually changed — a diff that touches HOME.md for
 * no reason is a diff a reviewer has to read.
 */
export function applyEdit(addressText: string, homeText: string, edit: HomeEdit): EditedFiles {
  const address = splitDocument(addressText);
  const home = splitDocument(homeText);

  const name = value(edit.name);
  const title = value(edit.title);

  if (address.lines) {
    setField(address.lines, "name", name);
    setField(address.lines, "household", value(edit.household));
    setField(address.lines, "note", value(edit.note), { optional: true, before: ["key"] });
  }

  if (home.lines) {
    setField(home.lines, "title", title);
    setField(home.lines, "location", value(edit.location));
    setField(home.lines, "style", value(edit.style), { optional: true, before: ["image"] });
  }

  // The heading follows the name it was made from — a renamed house whose
  // first line still says the old name reads like a stale copy. A document
  // that never had a heading doesn't grow one.
  const nextAddress = render(
    address,
    address.heading === null ? null : `# ${name}`,
    edit.intro,
    QUIET_DOORWAY,
  );
  const nextHome = render(
    home,
    home.heading === null ? null : `# ${title}`,
    edit.home,
    UNBUILT_HOME,
  );

  return {
    address: nextAddress === addressText.replace(/\r/g, "") ? null : nextAddress,
    home: nextHome === homeText.replace(/\r/g, "") ? null : nextHome,
  };
}

/**
 * What the form should open with: the town's current files, as fields.
 *
 * The town's own placeholder prose comes back as an empty field. It is not
 * something the resident wrote, and offering it as if it were makes a blank
 * home indistinguishable from a written one at a glance.
 */
export function editFromFiles(addressText: string, homeText: string): HomeEdit {
  const address = splitDocument(addressText);
  const home = splitDocument(homeText);
  const written = (body: string, placeholder: string) =>
    body.trim() === placeholder ? "" : body;

  return {
    name: field(address, "name"),
    household: field(address, "household"),
    note: field(address, "note"),
    intro: written(address.body, QUIET_DOORWAY),
    title: field(home, "title"),
    location: field(home, "location"),
    style: field(home, "style"),
    home: written(home.body, UNBUILT_HOME),
  };
}

/**
 * Point an existing ADDRESS.md at a different key.
 *
 * The one edit `applyEdit` refuses to make, kept separate because it is a
 * different act: the fields above are how a home looks, and this is who may
 * stand inside it. Account recovery is the only caller — a resident who lost
 * their private key gets a new one, and the address has to follow it or the
 * town stops recognising them.
 *
 * Rewrites the single `key:` line and nothing else, so the pull request a
 * reviewer sees is one line. Returns null when there is no key to replace,
 * rather than adding one: an address that never had a key is not a rotation.
 */
export function rekeyAddress(addressText: string, newPubkey: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(newPubkey)) return null;

  const document = splitDocument(addressText);
  if (!document.lines) return null;

  const index = document.lines.findIndex(entry => entry.key === "key");
  if (index === -1) return null;

  const normalized = addressText.replace(/\r/g, "");
  const before = normalized.slice(0, 4);
  const end = normalized.indexOf("\n---\n", 4);
  if (before !== "---\n" || end === -1) return null;

  const frontmatter = normalized.slice(4, end).split("\n");
  frontmatter[index] = `key: ${newPubkey}`;

  return `---\n${frontmatter.join("\n")}\n---\n${normalized.slice(end + 5)}`;
}
