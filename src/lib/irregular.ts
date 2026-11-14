/**
 * Amber's Adventures — The Verglas Irregular.
 *
 * The town's newspaper, with one editor. Her journal supplies the material,
 * and she sends it to press herself. Nothing here reads that journal: an issue
 * is made only of text the editor puts into a draft, and publishing makes a
 * separate, fixed copy of it, so editing the journal afterwards can never
 * change an edition people have already read.
 *
 * This file is the shape of the paper and nothing else. It has no fs, no env
 * and no crypto, because the editor's desk renders a preview in the browser
 * with the same rules the server uses to print it, and the two must not drift.
 */

export const MASTHEAD = {
  title: "Amber’s Adventures",
  subtitle: "The Verglas Irregular",
  disclaimer: "Published at the discretion of a highly unpredictable editor.",
  /** The small print. The first sentence is a link to writing her a letter. */
  corrections: "Corrections may be submitted.",
  unconvinced: "The editor may remain unconvinced.",
} as const;

/** The subject a correction arrives under, so she can tell which issue it's about. */
export function correctionSubject(number?: number | null): string {
  return number ? `A correction to The Irregular, No. ${number}` : "A correction to The Irregular";
}

/**
 * Where "Corrections may be submitted" leads. Letters leave from the writer's
 * own home, so a resident carrying their key goes to their own desk with the
 * letter already addressed to the editor. Anyone else is shown the editor's
 * home, which is her address in town.
 */
export function correctionsHref(editor: string, from: string | null, number?: number | null): string {
  if (!from || from === editor) return `/home/${editor}`;
  const query = new URLSearchParams({ to: editor, subject: correctionSubject(number) });
  return `/home/${from}/inside?${query.toString()}`;
}

/** Where the paper lives in the town. The archive is here, each issue under it. */
export const IRREGULAR_PATH = "/irregular";

export function issuePath(number: number): string {
  return `${IRREGULAR_PATH}/${number}`;
}

export const DESK_PATH = `${IRREGULAR_PATH}/desk`;

/**
 * `story` is one long piece in a single comfortable column. `columns` sets
 * short, separate pieces side by side on a wide screen. A phone always gets
 * one column, whichever the editor chose.
 */
export type IssueLayout = "story" | "columns";

export interface Piece {
  /** Optional. A single story usually leaves this blank and uses the issue's. */
  headline: string;
  body: string;
  /** Give this piece the page to itself: full width, with room around it. */
  alone: boolean;
}

/** Everything the editor writes. A draft and an issue both carry this. */
export interface IssueContent {
  headline: string;
  /** Optional line beneath the headline. */
  standfirst: string;
  /** The date printed on the issue, YYYY-MM-DD. */
  date: string;
  layout: IssueLayout;
  pieces: Piece[];
}

export interface Draft extends IssueContent {
  id: string;
  /** The number it will be printed as. Null takes the next one at press time. */
  number: number | null;
  createdAt: string;
  /** Also the draft's revision: publishing names it, so what was previewed is what prints. */
  updatedAt: string;
}

export interface Issue extends IssueContent {
  /** The issue's address. Fixed once printed. */
  number: number;
  publishedAt: string;
  /** Set by a correction. Null for an issue exactly as first printed. */
  updatedAt: string | null;
  /** The editor's note about the latest correction, printed beside "Updated". */
  correction: string;
  /** Taken off display. The number stays reserved and the issue can come back. */
  withdrawnAt: string | null;
}

/** A correction names this, so it cannot overwrite a correction it never saw. */
export function issueRevision(issue: Issue): string {
  return issue.updatedAt ?? issue.publishedAt;
}

export const LIMITS = {
  headline: 200,
  standfirst: 400,
  correction: 400,
  pieceHeadline: 200,
  pieceBody: 60_000,
  pieces: 12,
  total: 150_000,
  number: 99_999,
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIssueDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isIssueNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= LIMITS.number;
}

/** "17" → 17, and anything that isn't exactly a number in range → null. */
export function parseIssueNumber(value: string): number | null {
  if (!/^[1-9]\d{0,4}$/.test(value)) return null;
  const number = Number(value);
  return isIssueNumber(number) ? number : null;
}

/** The town keeps dates in UTC, as it does for joining and letters. */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Tidy what the editor sent without changing a word of it: line endings made
 * one kind, and trailing blanks removed. Inner spacing is hers — a poem's line
 * breaks are part of the poem.
 */
function tidyBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Read untrusted input into the shape of an issue. Never throws; `checkContent` judges it. */
export function readContent(input: unknown): IssueContent {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (field: unknown) => (typeof field === "string" ? field : "");
  const pieces = Array.isArray(value.pieces) ? value.pieces : [];

  return {
    headline: oneLine(text(value.headline)),
    standfirst: oneLine(text(value.standfirst)),
    date: text(value.date).trim(),
    layout: value.layout === "columns" ? "columns" : "story",
    pieces: pieces.slice(0, LIMITS.pieces + 1).map((raw) => {
      const piece = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        headline: oneLine(text(piece.headline)),
        body: tidyBody(text(piece.body)),
        alone: piece.alone === true,
      };
    }),
  };
}

/**
 * Whether an issue is fit to print, as a list of plain sentences.
 *
 * The desk shows these as they are, so they are written for the editor rather
 * than for a log.
 */
export function checkContent(content: IssueContent): string[] {
  const problems: string[] = [];

  if (!content.headline) problems.push("The issue needs a headline.");
  else if (content.headline.length > LIMITS.headline) {
    problems.push(`The headline is longer than ${LIMITS.headline} characters.`);
  }
  if (content.standfirst.length > LIMITS.standfirst) {
    problems.push(`The line under the headline is longer than ${LIMITS.standfirst} characters.`);
  }
  if (!isIssueDate(content.date)) problems.push("The date should be a real day, written YYYY-MM-DD.");

  if (content.pieces.length === 0) problems.push("There is nothing to print yet. Add a piece.");
  if (content.pieces.length > LIMITS.pieces) problems.push(`An issue holds at most ${LIMITS.pieces} pieces.`);

  let total = 0;
  content.pieces.forEach((piece, index) => {
    const which = content.pieces.length === 1 ? "The story" : `Piece ${index + 1}`;
    if (!piece.body.trim()) problems.push(`${which} has no words in it.`);
    if (piece.body.length > LIMITS.pieceBody) problems.push(`${which} is longer than the paper will hold.`);
    if (piece.headline.length > LIMITS.pieceHeadline) {
      problems.push(`${which} has a headline longer than ${LIMITS.pieceHeadline} characters.`);
    }
    total += piece.body.length + piece.headline.length;
  });
  if (total > LIMITS.total) problems.push("Altogether, this is longer than one issue will hold.");

  return problems;
}

export function emptyContent(now = new Date()): IssueContent {
  return {
    headline: "",
    standfirst: "",
    date: todayIso(now),
    layout: "story",
    pieces: [{ headline: "", body: "", alone: false }],
  };
}

/** Just the content of a draft or an issue, for comparing and for sending. */
export function contentOf(source: IssueContent): IssueContent {
  return {
    headline: source.headline,
    standfirst: source.standfirst,
    date: source.date,
    layout: source.layout,
    pieces: source.pieces.map((piece) => ({ headline: piece.headline, body: piece.body, alone: piece.alone })),
  };
}

/* ── Typesetting ────────────────────────────────────────────────────────── */

export type BodyBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "subhead"; text: string }
  | { kind: "break" };

const SECTION_BREAK = /^(?:\*\s*\*\s*\*|⁂|~{3,}|-{3,}|\*{3,})$/;

/**
 * A piece's words, as the blocks the page sets.
 *
 * A blank line ends a paragraph. A paragraph that is only `* * *` (or `***`,
 * `---`, `⁂`) is a pause in the story. A one-line paragraph starting `#` is a
 * subheading. Everything else is a paragraph, and the line breaks inside it
 * stay where she put them.
 */
export function bodyBlocks(body: string): BodyBlock[] {
  return tidyBody(body)
    .split(/\n[ \t]*\n+/)
    .map((chunk) => chunk.replace(/^\n+|\n+$/g, ""))
    .filter((chunk) => chunk.trim())
    .map((chunk): BodyBlock => {
      const trimmed = chunk.trim();
      if (SECTION_BREAK.test(trimmed)) return { kind: "break" };
      const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
      if (heading && !trimmed.includes("\n")) return { kind: "subhead", text: heading[1].trim() };
      return { kind: "paragraph", text: chunk };
    });
}

/** "2026-11-13" → "Friday, 13 November 2026". */
export function longDate(iso: string): string {
  if (!isIssueDate(iso)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** "2026-11-13" → "13 Nov 2026". */
export function shortDate(iso: string): string {
  if (!isIssueDate(iso)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** The first words of an issue, for a link preview. Plain text, no markers. */
export function issueSummary(content: IssueContent, length = 180): string {
  if (content.standfirst) return content.standfirst;
  const first = content.pieces
    .flatMap((piece) => bodyBlocks(piece.body))
    .find((block): block is { kind: "paragraph"; text: string } => block.kind === "paragraph");
  const text = (first?.text ?? "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1).replace(/\s+\S*$/, "")}…` : text;
}
