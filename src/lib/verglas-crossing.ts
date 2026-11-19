/**
 * Where a letter is on its way across town, read from its pull request.
 *
 * MAIL.md is the route: the letter is a pull request, Thaw's workflow reads it
 * and merges it when it is clean, and the same run carries it, filing a copy
 * in the recipient's inbox and the sender's `sent/`. That `sent/` copy carries
 * `delivered:` and `delivered_by:`, which Thaw adds only after the merge, so
 * it is the receipt. The whole round usually takes well under a minute.
 *
 * When a letter doesn't go through, Thaw says why in one comment, rewritten
 * on each reading, and labels it `needs-human` when the letter
 * waits on a person rather than on its sender.
 *
 * Pure, with no fetch or env, so the page that follows a letter and the route
 * that reads GitHub for it share one idea of what each stage means.
 */

export type CrossingStage =
  /** The pull request is open and Thaw hasn't started reading. */
  | "handed"
  /** Thaw's run is going. */
  | "reading"
  /** Merged. Thaw is filing it. */
  | "accepted"
  /** Filed. The receipt exists. */
  | "delivered"
  /** Thaw sent it back with a note, for the sender to fix. */
  | "revise"
  /** Thaw asked a maintainer to look. */
  | "human"
  /** Thaw's run failed or never started, so nobody has read it. */
  | "held"
  /** Closed without being merged. */
  | "closed";

export interface Crossing {
  stage: CrossingStage;
  /** The pull request, where the crossing can be watched. */
  url: string;
  /** Thaw's note as plain text, when it matters to the sender. */
  note: string | null;
  noteUrl: string | null;
  /** The delivered copy, which is Thaw's receipt. */
  receiptUrl: string | null;
  /** When it was delivered (ISO), from the receipt. */
  delivered: string | null;
  /** When Thaw merged it (ISO). */
  mergedAt: string | null;
}

/** Nothing further will happen to a letter in these stages. */
export function isFinal(stage: CrossingStage): boolean {
  return stage === "delivered" || stage === "closed";
}

/** Thaw's comment starts with this, and it's how Thaw finds it again to rewrite it. */
export const THAW_MARKER = "<!-- thaw:review -->";

/** Thaw comments as the workflow's own token, which GitHub shows as this account. */
export const THAW_COMMENTER = "github-actions[bot]";

export const HUMAN_LABEL = "needs-human";

/**
 * A letter with no run of Thaw's after this long isn't going to get one by
 * itself. Thaw's run usually starts a few seconds after the letter is sent.
 */
export const HELD_AFTER_MS = 3 * 60_000;

export interface GitHubComment {
  body: string;
  user: { login: string } | null;
  html_url: string;
  updated_at: string;
}

/**
 * Thaw's comment on a pull request, if there is one.
 *
 * It's the marker *and* the account. Anyone can write the marker into a
 * comment of their own, and a note that only looked like Thaw's must never
 * reach the sender's page as Thaw's.
 */
export function thawComment(comments: GitHubComment[]): GitHubComment | null {
  const thaws = comments.filter(
    (comment) => comment.user?.login === THAW_COMMENTER && comment.body?.startsWith(THAW_MARKER),
  );
  return thaws.at(-1) ?? null;
}

/**
 * Thaw's note, as words for the page rather than markdown for GitHub.
 *
 * The page renders it as text, never as HTML. This only strips what would
 * read as noise there: the marker, the signature, the line that summons a
 * maintainer by @-name, and markdown's emphasis and quote marks.
 */
export function thawNote(body: string, max = 1500): string {
  const text = body
    .replace(THAW_MARKER, "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !/^\s*\*?—\s*Thaw of Verglas\*?\s*$/.test(line))
    .filter((line) => !/^\s*@\S+\s+—/.test(line))
    .map((line) => line.replace(/^\s*>\s?/, "").replace(/\*\*|__|`/g, "").replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|[.,;:!?)]|$)/g, "$1$2"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
}

/** What GitHub says about a letter, reduced to what its stage depends on. */
export interface CrossingFacts {
  url: string;
  state: "open" | "closed";
  merged: boolean;
  mergedAt: string | null;
  createdAt: string;
  labels: string[];
  /** Thaw's latest run for the pull request's current head. */
  run: { status: string; conclusion: string | null; createdAt: string } | null;
  comment: GitHubComment | null;
  /** The delivered copy in the sender's `sent/`, once it exists. */
  receipt: { url: string; delivered: string } | null;
}

export function crossingFrom(facts: CrossingFacts, now = Date.now()): Crossing {
  const quiet: Crossing = {
    stage: "handed",
    url: facts.url,
    note: null,
    noteUrl: null,
    receiptUrl: null,
    delivered: null,
    mergedAt: facts.mergedAt,
  };
  const withNote = (stage: CrossingStage): Crossing =>
    facts.comment
      ? { ...quiet, stage, note: thawNote(facts.comment.body), noteUrl: facts.comment.html_url }
      : { ...quiet, stage };

  if (facts.receipt) {
    return { ...quiet, stage: "delivered", receiptUrl: facts.receipt.url, delivered: facts.receipt.delivered };
  }
  if (facts.merged) return { ...quiet, stage: "accepted" };
  if (facts.state === "closed") return withNote("closed");

  if (facts.labels.includes(HUMAN_LABEL)) return withNote("human");

  const { run } = facts;
  if (!run) {
    return now - Date.parse(facts.createdAt) > HELD_AFTER_MS ? { ...quiet, stage: "held" } : quiet;
  }
  if (run.status !== "completed") return { ...quiet, stage: run.status === "in_progress" ? "reading" : "handed" };

  // Thaw speaks during the run, so only a comment from this run is about this
  // version of the letter. One from an earlier run is left over.
  const fresh = facts.comment && Date.parse(facts.comment.updated_at) >= Date.parse(run.createdAt);
  if (run.conclusion === "success") {
    // Thaw merges, then says so. Read in between those two, the pull request
    // can still look open, so Thaw saying so counts as the merge.
    if (fresh && /^\s*Checked and (carried|merged)/m.test(thawNote(facts.comment!.body))) {
      return { ...quiet, stage: "accepted" };
    }
    // A finished run that said nothing new is the moment between Thaw's merge
    // and GitHub reporting it. The next look will show which.
    return fresh ? withNote("revise") : { ...quiet, stage: "reading" };
  }
  return { ...quiet, stage: "held" };
}

/** "2026-11-19T04:21:24.408Z" → "19 Nov 2026, 04:21 UTC". The same on server and browser. */
export function deliveredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  return `${day}, ${date.toISOString().slice(11, 16)} UTC`;
}
