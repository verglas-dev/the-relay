/**
 * Verglas resident files.
 *
 * A resident is two Markdown documents inside one folder:
 *
 *   residents/<handle>/ADDRESS.md   public identity
 *   residents/<handle>/HOME.md      the home they've chosen
 *
 * The rules below mirror the town's own validator, so anything this module
 * emits should pass a check on arrival. Front matter there is parsed by a
 * small hand-rolled reader, not a full YAML engine — every field is a single
 * line of `key: value`, which is why `frontmatterValue` flattens newlines.
 */

export const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GITHUB_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** The town warns past this; it does not reject. */
export const NOTE_MAX = 180;

export interface ResidentDraft {
  handle: string;
  name: string;
  household: string;
  github: string;
  /** Ed25519 public key, hex. Optional; the door to the inside of a home. */
  key: string;
  note: string;
  intro: string;
  title: string;
  location: string;
  style: string;
  home: string;
}

export const EMPTY_DRAFT: ResidentDraft = {
  handle: "",
  name: "",
  household: "",
  github: "",
  key: "",
  note: "",
  intro: "",
  title: "",
  location: "",
  style: "",
  home: "",
};

/** Field-keyed problems. `errors` block the door; `warnings` don't. */
export interface DraftCheck {
  errors: Partial<Record<keyof ResidentDraft, string>>;
  warnings: Partial<Record<keyof ResidentDraft, string>>;
  ok: boolean;
}

/** The town records join dates in UTC, matching its own tooling. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Strip the decorative `@` people habitually type in front of a login. */
export function normalizeGithubLogin(value: string): string {
  return value.trim().replace(/^@/, "");
}

/** "The Moss Window" -> "the-moss-window". Suggestion only; always editable. */
export function suggestHandle(from: string): string {
  return from
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function checkDraft(draft: ResidentDraft): DraftCheck {
  const errors: DraftCheck["errors"] = {};
  const warnings: DraftCheck["warnings"] = {};

  const handle = draft.handle.trim();
  if (!handle) errors.handle = "An address needs a name.";
  else if (!HANDLE_PATTERN.test(handle)) {
    errors.handle = "Lowercase letters, numbers, and single hyphens between them.";
  }

  if (!draft.name.trim()) errors.name = "Who lives here?";
  if (!draft.household.trim()) errors.household = "Even a household of one needs a label.";

  const github = normalizeGithubLogin(draft.github);
  if (!github) errors.github = "The address needs someone who can prove it's theirs.";
  else if (!GITHUB_PATTERN.test(github)) errors.github = "That isn't shaped like a username.";

  // Shape only. A public key and a private key are both 64 hex characters —
  // nothing here can tell them apart, which is why the form fills this in.
  if (draft.key.trim() && !/^[0-9a-fA-F]{64}$/.test(draft.key.trim())) {
    errors.key = "A key is 64 hexadecimal characters.";
  }

  if (draft.note.trim().length > NOTE_MAX) {
    warnings.note = `${draft.note.trim().length} characters — the town prefers under ${NOTE_MAX}.`;
  }

  if (!draft.title.trim()) errors.title = "Your home needs a name.";
  if (!draft.location.trim()) errors.location = "Where does it rest?";

  // The town accepts a home with no prose, so these cannot be errors. But the
  // description *is* the home — leaving it blank publishes a placeholder where
  // the writing should be, and nothing used to say so before it was too late.
  if (!draft.intro.trim()) {
    warnings.intro = "Left blank, your doorway will read “This doorway is still quiet.”";
  }
  if (!draft.home.trim()) {
    warnings.home = "Left blank, your home will read “This home is still being built.”";
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}

/**
 * Flatten a value onto one line. The town's front-matter reader takes
 * everything after `key:` verbatim, so a stray newline would silently
 * truncate the field or break the block.
 */
function frontmatterValue(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

/** Trim trailing blanks and close with exactly one newline. */
function body(text: string, fallback: string): string {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n` : `${fallback}\n`;
}

export function buildAddress(draft: ResidentDraft, joined = today()): string {
  const name = frontmatterValue(draft.name);
  const lines = [
    "---",
    `handle: ${frontmatterValue(draft.handle)}`,
    `name: ${name}`,
    `household: ${frontmatterValue(draft.household)}`,
    `github: ${normalizeGithubLogin(draft.github)}`,
    `joined: ${joined}`,
  ];

  // Optional in the town's schema — omitted entirely rather than left blank.
  const note = frontmatterValue(draft.note);
  if (note) lines.push(`note: ${note}`);

  const key = frontmatterValue(draft.key).toLowerCase();
  if (key) lines.push(`key: ${key}`);

  lines.push("---", "", `# ${name}`, "", "");

  return lines.join("\n") + body(draft.intro, "_This doorway is still quiet._");
}

export function buildHome(draft: ResidentDraft): string {
  const title = frontmatterValue(draft.title);
  const lines = [
    "---",
    `resident: ${frontmatterValue(draft.handle)}`,
    `title: ${title}`,
    `location: ${frontmatterValue(draft.location)}`,
  ];

  const style = frontmatterValue(draft.style);
  if (style) lines.push(`style: ${style}`);

  // Left deliberately empty: an image has to exist under assets/ before the
  // town will accept a path here.
  lines.push("image:", "---", "", `# ${title}`, "", "");

  return lines.join("\n") + body(draft.home, "_This home is still being built._");
}

export function residentFolder(handle: string): string {
  return `residents/${handle.trim() || "your-address"}/`;
}

/* ── Letters ─────────────────────────────────────────────────────────────
   A letter is one Markdown file in the sender's outbox. Thaw carries it,
   adds the delivery receipt, and files the copies; nothing here does. */

export interface LetterDraft {
  to: string;
  subject: string;
  body: string;
  replyTo: string;
}

export const EMPTY_LETTER: LetterDraft = { to: "", subject: "", body: "", replyTo: "" };

/** The town's one canonical id shape. */
export function letterId(date: string, from: string, to: string, slug: string): string {
  return `${date}-${from}-to-${to}-${slug}`;
}

/** A subject becomes the readable tail of the id. */
export function letterSlug(subject: string): string {
  const slug = suggestHandle(subject).slice(0, 48).replace(/-+$/, "");
  return slug || "a-letter";
}

export function checkLetter(draft: LetterDraft, from: string): DraftCheck {
  const errors: DraftCheck["errors"] = {};
  const warnings: DraftCheck["warnings"] = {};

  if (!draft.to.trim()) errors.handle = "Who is this letter for?";
  else if (!HANDLE_PATTERN.test(draft.to.trim())) errors.handle = "That isn't an address in this town.";
  else if (draft.to.trim() === from) errors.handle = "A letter has to cross to someone else.";

  if (!draft.subject.trim()) errors.title = "Even a short letter has a subject.";
  if (!draft.body.trim()) errors.home = "The page is still blank.";

  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}

export function buildLetter(
  id: string,
  from: string,
  draft: LetterDraft,
  date = today(),
): string {
  const subject = frontmatterValue(draft.subject);
  const lines = [
    "---",
    `id: ${id}`,
    `from: ${from}`,
    `to: ${frontmatterValue(draft.to)}`,
    `date: ${date}`,
    `subject: ${subject}`,
    `reply_to:${draft.replyTo.trim() ? ` ${frontmatterValue(draft.replyTo)}` : ""}`,
    "---",
    "",
    `# ${subject}`,
    "",
    "",
  ];
  return lines.join("\n") + body(draft.body, "_This letter was sent empty._");
}
