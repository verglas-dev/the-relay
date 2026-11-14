import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  checkContent,
  contentOf,
  issueRevision,
  isIssueNumber,
  type Draft,
  type Issue,
  type IssueContent,
} from "./irregular";

/**
 * Where the paper is kept: the editor's drafts and every printed issue.
 *
 * One JSON file, written beside itself and renamed into place, with writes in
 * a single chain, which is the town's usual store discipline. Here it is also
 * how "publish everything together" is kept. The issue page, the archive and
 * the gate's clipping all read this one file, and printing an issue is one
 * rename. Either the new issue is in the file, ready to read, or the file is
 * as it was. There is no in-between where the gate announces a number whose
 * page does not exist.
 *
 * Drafts are private: they are only handed out at the press, to the editor's
 * signature. They are not encrypted, so whoever runs the server can read them,
 * as with a guest room. The desk says so.
 *
 * Not the town repository. That is public, so a draft committed there would
 * be published before its editor had decided to publish it.
 */

interface PaperFile {
  drafts: Record<string, Draft>;
  issues: Record<string, Issue>;
}

let writeChain: Promise<void> = Promise.resolve();

/** Runtime data on its own volume in production, never a build input. */
function storePath(): string {
  const fromEnv = process.env.IRREGULAR_STORE_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(/* turbopackIgnore: true */ process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), "data", "irregular.json");
}

async function readFile(): Promise<PaperFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ storePath(), "utf8")) as Partial<PaperFile>;
    return { drafts: parsed.drafts ?? {}, issues: parsed.issues ?? {} };
  } catch (error) {
    // No paper yet is an empty paper. A file that exists but will not parse is
    // not, and treating it as empty would let the next write erase every issue.
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { drafts: {}, issues: {} };
    throw error;
  }
}

async function writeFile(data: PaperFile): Promise<void> {
  const file = storePath();
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(/* turbopackIgnore: true */ temp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(/* turbopackIgnore: true */ temp, file);
}

function withWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

/** A refusal the desk can show as it is. `status` is the HTTP answer for it. */
export class PressRefusal extends Error {
  constructor(message: string, readonly status: number, readonly problems: string[] = []) {
    super(message);
  }
}

/** A timestamp that always moves forward, so a revision is never reused. */
function stamp(previous?: string | null): string {
  const now = new Date();
  if (previous && now.toISOString() <= previous) return new Date(Date.parse(previous) + 1).toISOString();
  return now.toISOString();
}

function nextNumberIn(store: PaperFile): number {
  const numbers = Object.values(store.issues).map((issue) => issue.number);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function sortedIssues(store: PaperFile): Issue[] {
  return Object.values(store.issues).sort((a, b) => b.number - a.number);
}

/* ── Public reading ─────────────────────────────────────────────────────── */

/** Every issue on display, newest first. Withdrawn issues are not listed. */
export async function publishedIssues(): Promise<Issue[]> {
  return sortedIssues(await readFile()).filter((issue) => !issue.withdrawnAt);
}

/** The numbers of withdrawn issues, so the archive can account for them. Numbers only. */
export async function withdrawnNumbers(): Promise<number[]> {
  return sortedIssues(await readFile())
    .filter((issue) => issue.withdrawnAt)
    .map((issue) => issue.number);
}

export async function latestIssue(): Promise<Issue | null> {
  return (await publishedIssues())[0] ?? null;
}

/**
 * One issue, with the issues either side of it on display. A withdrawn issue
 * comes back too, so its page can say it was withdrawn rather than pretend
 * the number never existed.
 */
export async function readIssue(
  number: number,
): Promise<{ issue: Issue; previous: Issue | null; next: Issue | null } | null> {
  const store = await readFile();
  const issue = store.issues[String(number)];
  if (!issue) return null;
  const shown = sortedIssues(store).filter((other) => !other.withdrawnAt);
  return {
    issue,
    previous: shown.find((other) => other.number < number) ?? null,
    next: [...shown].reverse().find((other) => other.number > number) ?? null,
  };
}

/* ── The editor's desk ──────────────────────────────────────────────────── */

export interface DeskView {
  drafts: Draft[];
  /** Every issue, withdrawn ones included, newest first. */
  issues: Issue[];
  nextNumber: number;
}

export async function deskView(): Promise<DeskView> {
  const store = await readFile();
  return {
    drafts: Object.values(store.drafts).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    issues: sortedIssues(store),
    nextNumber: nextNumberIn(store),
  };
}

export async function getDraft(id: string): Promise<Draft | null> {
  return (await readFile()).drafts[id] ?? null;
}

const NO_DRAFT = () => new PressRefusal("there is no draft by that name", 404);
const CHANGED = () =>
  new PressRefusal("that changed since you opened it — open it again to see the newer version", 409);

function checkNumber(store: PaperFile, number: number | null): void {
  if (number === null) return;
  if (!isIssueNumber(number)) throw new PressRefusal("an issue number is a whole number from 1 to 99999", 400);
  if (store.issues[String(number)]) {
    throw new PressRefusal(`No. ${number} has already been printed — choose another number`, 409);
  }
}

/**
 * Save a draft, new or existing. A draft may be unfinished, so its content is
 * not checked here. That happens at press time. Its number is checked, so the
 * editor hears about a clash while there is still time to choose another.
 *
 * `revision` is the `updatedAt` the editor last saw. A save that names an old
 * one is refused rather than allowed to overwrite a newer save from another
 * window or a daemon.
 */
export async function saveDraft(params: {
  id?: string;
  revision?: string;
  number: number | null;
  content: IssueContent;
}): Promise<Draft> {
  return withWrite(async () => {
    const store = await readFile();
    checkNumber(store, params.number);

    const existing = params.id ? store.drafts[params.id] : undefined;
    if (params.id && !existing) throw NO_DRAFT();
    if (existing && params.revision !== existing.updatedAt) throw CHANGED();

    const id = existing?.id ?? randomBytes(8).toString("hex");
    const draft: Draft = {
      ...contentOf(params.content),
      id,
      number: params.number,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: stamp(existing?.updatedAt),
    };
    store.drafts[id] = draft;
    await writeFile(store);
    return draft;
  });
}

export async function discardDraft(id: string): Promise<void> {
  return withWrite(async () => {
    const store = await readFile();
    if (!store.drafts[id]) throw NO_DRAFT();
    delete store.drafts[id];
    await writeFile(store);
  });
}

/**
 * Send a draft to press.
 *
 * Everything happens in one write, or nothing does. The content is checked,
 * the number settled, the fixed copy made and the draft cleared, and only
 * then is the file renamed into place. A refusal at any step leaves the paper
 * exactly as it was.
 */
export async function publishDraft(id: string, revision: string): Promise<Issue> {
  return withWrite(async () => {
    const store = await readFile();
    const draft = store.drafts[id];
    if (!draft) throw NO_DRAFT();
    if (draft.updatedAt !== revision) throw CHANGED();

    const problems = checkContent(draft);
    if (problems.length) throw new PressRefusal("that draft is not ready to print", 422, problems);

    checkNumber(store, draft.number);
    const number = draft.number ?? nextNumberIn(store);

    const issue: Issue = {
      ...contentOf(draft),
      number,
      publishedAt: new Date().toISOString(),
      updatedAt: null,
      correction: "",
      withdrawnAt: null,
    };
    store.issues[String(number)] = issue;
    delete store.drafts[id];
    await writeFile(store);
    return issue;
  });
}

export async function getIssue(number: number): Promise<Issue | null> {
  return (await readFile()).issues[String(number)] ?? null;
}

/**
 * Correct a printed issue in place. Its number, and so its address, stay the
 * same, and the page shows that it was updated. The old wording is not kept:
 * a correction exists to replace it.
 */
export async function correctIssue(params: {
  number: number;
  revision: string;
  content: IssueContent;
  note: string;
}): Promise<Issue> {
  return withWrite(async () => {
    const store = await readFile();
    const issue = store.issues[String(params.number)];
    if (!issue) throw new PressRefusal("there is no issue with that number", 404);
    if (issueRevision(issue) !== params.revision) throw CHANGED();

    const problems = checkContent(params.content);
    if (problems.length) throw new PressRefusal("that correction is not ready to print", 422, problems);

    const corrected: Issue = {
      ...issue,
      ...contentOf(params.content),
      updatedAt: stamp(issueRevision(issue)),
      correction: params.note,
    };
    store.issues[String(issue.number)] = corrected;
    await writeFile(store);
    return corrected;
  });
}

/** Take an issue off display, or put it back. Its number stays its own. */
export async function setWithdrawn(number: number, withdrawn: boolean): Promise<Issue> {
  return withWrite(async () => {
    const store = await readFile();
    const issue = store.issues[String(number)];
    if (!issue) throw new PressRefusal("there is no issue with that number", 404);
    const changed: Issue = { ...issue, withdrawnAt: withdrawn ? (issue.withdrawnAt ?? new Date().toISOString()) : null };
    store.issues[String(number)] = changed;
    await writeFile(store);
    return changed;
  });
}
