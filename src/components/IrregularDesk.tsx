"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, FilePlus2, Lock, Newspaper, Trash2 } from "lucide-react";
import { IrregularCard } from "@/components/IrregularCard";
import { IssueSheet } from "@/components/IrregularSheet";
import { useIdentity } from "@/lib/identity-context";
import { loadIdentity } from "@/lib/browser-identity";
import {
  checkContent,
  contentOf,
  emptyContent,
  issuePath,
  issueRevision,
  LIMITS,
  MASTHEAD,
  parseIssueNumber,
  readContent,
  type Draft,
  type Issue,
  type IssueContent,
  type Piece,
} from "@/lib/irregular";
import {
  correctIssue,
  discardDraft,
  openDesk,
  publishDraft,
  saveDraft,
  setIssueExcerpt,
  withdrawIssue,
  type DeskData,
  type Identity,
} from "@/lib/irregular-client";
import { townUrl } from "@/lib/verglas-site";
import { cn } from "@/lib/utils";

/**
 * The editor's desk.
 *
 * Draft, preview and send to press, then correct or withdraw what was printed.
 * Every one of those is a signed request to the press, which answers to the
 * editor's key alone. This component only decides what to draw.
 *
 * Confirmations happen on the page, never in a browser dialog. A dialog would
 * stall anyone who works this desk through browser automation, and the
 * editor may well be one of them.
 */

type Editing =
  | { kind: "draft"; draft: Draft | null }
  | { kind: "issue"; issue: Issue };

type Confirming = "publish" | "discard" | "correct" | "withdraw" | null;

const FIELD =
  "w-full rounded-lg border border-ink-700/60 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-vb-500/50 focus:outline-none";
const LABEL = "mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-ink-500";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

const same = (a: IssueContent, b: IssueContent) => JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));

/** As the press keeps it: one line, no spare spaces. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function IrregularDesk() {
  const { identity } = useIdentity();
  const [mounted, setMounted] = useState(false);
  const [desk, setDesk] = useState<DeskData | null>(null);
  const [refusal, setRefusal] = useState<{ status: number; error: string } | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [content, setContent] = useState<IssueContent>(() => emptyContent());
  const [numberText, setNumberText] = useState("");
  const [note, setNote] = useState("");
  // The line The Relay's card quotes. Saved with a draft; on a printed issue it
  // has its own button, because changing it isn't a correction.
  const [excerpt, setExcerpt] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [previewed, setPreviewed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; problems?: string[] } | null>(null);
  const [printed, setPrinted] = useState<{ number: number; url: string; verb: string } | null>(null);

  useEffect(() => setMounted(true), []);

  const key: Identity | null = identity;

  const refresh = useCallback(async () => {
    if (!key) return null;
    const answer = await openDesk(key);
    if (!answer.ok || !answer.data) {
      setRefusal({ status: answer.status, error: answer.error ?? "the press did not answer" });
      setDesk(null);
      return null;
    }
    setRefusal(null);
    setDesk(answer.data);
    return answer.data;
  }, [key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ── What is open, and whether it has changed ──────────────────────────── */

  const baseline = useMemo<{ content: IssueContent; number: string; note: string; excerpt: string } | null>(() => {
    if (!editing) return null;
    if (editing.kind === "issue") {
      return { content: contentOf(editing.issue), number: "", note: editing.issue.correction, excerpt: editing.issue.excerpt ?? "" };
    }
    if (!editing.draft) return { content: emptyContent(), number: "", note: "", excerpt: "" };
    return {
      content: contentOf(editing.draft),
      number: editing.draft.number ? String(editing.draft.number) : "",
      note: "",
      excerpt: editing.draft.excerpt ?? "",
    };
  }, [editing]);

  const tidyExcerpt = oneLine(excerpt);
  const excerptChanged = !!baseline && baseline.excerpt !== tidyExcerpt;

  // For a printed issue the excerpt is left out: it isn't part of a correction.
  const dirty =
    !!baseline &&
    (!same(baseline.content, content) || baseline.number !== numberText || baseline.note !== note ||
      (editing?.kind === "draft" && (excerptChanged || !editing.draft)));

  // What the press would make of this, checked as she types.
  const tidy = useMemo(() => readContent(content), [content]);
  const problems = useMemo(() => {
    const found = checkContent(tidy);
    if (editing?.kind === "draft" && numberText.trim() && parseIssueNumber(numberText.trim()) === null) {
      found.push("The issue number should be a whole number from 1 to 99999.");
    }
    return found;
  }, [tidy, editing, numberText]);

  function open(next: Editing) {
    setEditing(next);
    setConfirming(null);
    setMessage(null);
    setTab("write");
    setPreviewed(false);
    if (next.kind === "issue") {
      setContent(contentOf(next.issue));
      setNumberText("");
      setNote(next.issue.correction);
      setExcerpt(next.issue.excerpt ?? "");
    } else {
      setContent(next.draft ? contentOf(next.draft) : emptyContent());
      setNumberText(next.draft?.number ? String(next.draft.number) : "");
      setNote("");
      setExcerpt(next.draft?.excerpt ?? "");
    }
  }

  /** The same issue after a change to it, keeping an excerpt she has typed but not yet put on the card. */
  function reopen(issue: Issue) {
    const typed = excerpt;
    open({ kind: "issue", issue });
    setExcerpt(typed);
  }

  function edit(change: Partial<IssueContent>) {
    setContent((current) => ({ ...current, ...change }));
    setPreviewed(false);
    setConfirming(null);
  }

  function editPiece(index: number, change: Partial<Piece>) {
    edit({ pieces: content.pieces.map((piece, i) => (i === index ? { ...piece, ...change } : piece)) });
  }

  function movePiece(index: number, by: -1 | 1) {
    const pieces = [...content.pieces];
    const target = index + by;
    if (target < 0 || target >= pieces.length) return;
    [pieces[index], pieces[target]] = [pieces[target], pieces[index]];
    edit({ pieces });
  }

  function removePiece(index: number) {
    edit({ pieces: content.pieces.filter((_, i) => i !== index) });
  }

  function addPiece() {
    const pieces = [...content.pieces, { headline: "", body: "", alone: false }];
    // A second piece is the moment a story becomes separate pieces.
    edit({ pieces, layout: pieces.length > 1 && content.pieces.length === 1 ? "columns" : content.layout });
  }

  /* ── Talking to the press ──────────────────────────────────────────────── */

  function failed(error: string | undefined, found?: string[]) {
    setMessage({ tone: "error", text: error ?? "the press did not answer", problems: found });
  }

  async function save(): Promise<Draft | null> {
    if (!key || editing?.kind !== "draft") return null;
    const number = numberText.trim() ? parseIssueNumber(numberText.trim()) : null;
    if (numberText.trim() && number === null) {
      failed("The issue number should be a whole number from 1 to 99999.");
      return null;
    }
    setBusy(true);
    const answer = await saveDraft(key, {
      id: editing.draft?.id,
      revision: editing.draft?.updatedAt,
      number,
      content: tidy,
      excerpt: tidyExcerpt,
    });
    setBusy(false);
    if (!answer.ok || !answer.data) {
      failed(answer.error, answer.problems);
      return null;
    }
    const draft = answer.data.draft;
    setEditing({ kind: "draft", draft });
    setContent(contentOf(draft));
    setExcerpt(draft.excerpt ?? "");
    setMessage({ tone: "ok", text: `Saved ${when(draft.updatedAt)}.` });
    void refresh();
    return draft;
  }

  async function publish() {
    if (!key || editing?.kind !== "draft" || !editing.draft || dirty) return;
    setBusy(true);
    const answer = await publishDraft(key, editing.draft.id, editing.draft.updatedAt);
    setBusy(false);
    setConfirming(null);
    if (!answer.ok || !answer.data) return failed(answer.error, answer.problems);
    setPrinted({ number: answer.data.issue.number, url: answer.data.url, verb: "is printed" });
    setEditing(null);
    setMessage(null);
    void refresh();
  }

  async function discard() {
    if (!key || editing?.kind !== "draft") return;
    if (!editing.draft) {
      setEditing(null);
      setConfirming(null);
      return;
    }
    setBusy(true);
    const answer = await discardDraft(key, editing.draft.id);
    setBusy(false);
    setConfirming(null);
    if (!answer.ok) return failed(answer.error);
    setEditing(null);
    setMessage(null);
    void refresh();
  }

  async function correct() {
    if (!key || editing?.kind !== "issue") return;
    setBusy(true);
    const answer = await correctIssue(key, {
      number: editing.issue.number,
      revision: issueRevision(editing.issue),
      content: tidy,
      note: note.trim(),
    });
    setBusy(false);
    setConfirming(null);
    if (!answer.ok || !answer.data) return failed(answer.error, answer.problems);
    const issue = answer.data.issue;
    reopen(issue);
    setPrinted({ number: issue.number, url: answer.data.url, verb: "is corrected" });
    void refresh();
  }

  /**
   * Put a printed issue's excerpt on The Relay's card. No confirmation: it
   * changes nothing on the sheet, and a different line can go up at any time.
   * A correction she is partway through stays as it is.
   */
  async function saveExcerpt() {
    if (!key || editing?.kind !== "issue") return;
    setBusy(true);
    const answer = await setIssueExcerpt(key, editing.issue.number, tidyExcerpt);
    setBusy(false);
    if (!answer.ok || !answer.data) return failed(answer.error);
    const issue = answer.data.issue;
    setEditing({ kind: "issue", issue });
    setExcerpt(issue.excerpt ?? "");
    setMessage({
      tone: "ok",
      text: issue.excerpt
        ? `The Relay’s card for No. ${issue.number} now quotes your excerpt.`
        : `The Relay’s card for No. ${issue.number} shows its headline again.`,
    });
    void refresh();
  }

  async function setShown(issue: Issue, withdraw: boolean) {
    if (!key) return;
    setBusy(true);
    const answer = await withdrawIssue(key, issue.number, withdraw);
    setBusy(false);
    setConfirming(null);
    if (!answer.ok || !answer.data) return failed(answer.error);
    reopen(answer.data.issue);
    setPrinted({
      number: issue.number,
      url: answer.data.url,
      verb: withdraw ? "is withdrawn — its address now says so" : "is back on display",
    });
    void refresh();
  }

  /* ── Drawing it ────────────────────────────────────────────────────────── */

  const header = (
    <header className="mb-8">
      <p className="mb-2 flex items-center gap-2 text-eyebrow uppercase text-frost-300/80">
        <Newspaper className="h-3.5 w-3.5" aria-hidden="true" /> {MASTHEAD.subtitle}
      </p>
      <h1 className="font-display text-4xl font-bold tracking-tight text-white">The editor’s desk</h1>
    </header>
  );

  const waitingForKey = mounted && !identity && loadIdentity() !== null;

  if (!mounted || waitingForKey || (identity && !desk && !refusal)) {
    return (
      <>
        {header}
        <p className="text-ink-500">Opening the desk…</p>
      </>
    );
  }

  if (!identity || refusal) {
    const text = !identity
      ? "Bring your key (top right, or in the menu on a phone) to open the desk. The press answers only to the paper’s editor, and knows her by the key her home answers to."
      : refusal?.status === 403
        ? "This key isn’t the editor’s. The desk opens only for the editor of the paper."
        : refusal?.status === 503
          ? "The press has no editor yet. Whoever runs the town names one on the server."
          : `The press didn’t open: ${refusal?.error}.`;
    return (
      <>
        {header}
        <div className="glass-card max-w-2xl p-6 text-ink-300 leading-relaxed">
          <p>{text}</p>
          <p className="mt-3 text-sm text-ink-500">
            The paper itself is open to everyone:{" "}
            <Link href="/irregular" className="text-frost-300 underline underline-offset-2 hover:text-frost-200">
              read the issues
            </Link>
            .
          </p>
        </div>
      </>
    );
  }

  const data = desk!;
  const draftNumber = editing?.kind === "draft" ? (parseIssueNumber(numberText.trim()) ?? null) : null;
  const printsAs = editing?.kind === "issue" ? editing.issue.number : (draftNumber ?? data.nextNumber);
  const savedDraft = editing?.kind === "draft" ? editing.draft : null;

  return (
    <>
      {header}
      {/* Said before anything else on the desk, and in that order: what is
          protected, then exactly where the protection stops. "Only your key"
          on its own reads as absolute, and it isn't. */}
      <div className="-mt-2 mb-8 flex max-w-3xl gap-3 rounded-xl border border-frost-300/30 bg-frost-500/[0.07] p-4 text-sm leading-relaxed text-ink-200">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-frost-300" aria-hidden="true" />
        <div className="space-y-2">
          <p>
            <strong className="font-semibold text-ink-50">Drafts are private, not secret.</strong> Nothing here is
            public until you print it, and the press hands drafts only to your key. But they are stored unencrypted
            on the town’s server, so whoever runs that server can read them. Use the desk for writing you mean to
            publish, not for private journal material.
          </p>
          <p className="text-ink-300">
            Printing makes a separate, fixed copy. Later changes to your journal, or to another draft, never reach
            an issue already printed.
          </p>
        </div>
      </div>

      {printed && (
        <div className="glass-card mb-6 flex flex-wrap items-center justify-between gap-3 border-emerald-500/25 p-4 text-sm">
          <p className="text-emerald-200">
            No. {printed.number} {printed.verb}.{" "}
            <a href={printed.url} target="_blank" rel="noopener" className="font-mono text-emerald-300 underline underline-offset-2">
              {printed.url}
            </a>
          </p>
          <button type="button" className="btn-ghost text-xs" onClick={() => setPrinted(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* The spike: drafts, and what has been printed. */}
        <aside className="space-y-6">
          <button
            type="button"
            className="btn-primary w-full gap-2 py-2 text-sm"
            onClick={() => open({ kind: "draft", draft: null })}
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" /> New draft
          </button>

          <section>
            <h2 className={LABEL}>Drafts</h2>
            {data.drafts.length === 0 ? (
              <p className="text-sm text-ink-500">None in progress.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.drafts.map((draft) => (
                  <li key={draft.id}>
                    <button
                      type="button"
                      onClick={() => open({ kind: "draft", draft })}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        savedDraft?.id === draft.id
                          ? "border-vb-500/40 bg-vb-500/10 text-ink-100"
                          : "border-ink-700/40 bg-ink-900/40 text-ink-300 hover:border-ink-600 hover:text-ink-100",
                      )}
                    >
                      <span className="block truncate font-medium">{draft.headline || "Untitled draft"}</span>
                      <span className="block text-xs text-ink-500">
                        {draft.number ? `as No. ${draft.number} · ` : ""}
                        {when(draft.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className={LABEL}>Printed</h2>
            {data.issues.length === 0 ? (
              <p className="text-sm text-ink-500">Nothing yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.issues.map((issue) => (
                  <li key={issue.number}>
                    <button
                      type="button"
                      onClick={() => open({ kind: "issue", issue })}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        editing?.kind === "issue" && editing.issue.number === issue.number
                          ? "border-vb-500/40 bg-vb-500/10 text-ink-100"
                          : "border-ink-700/40 bg-ink-900/40 text-ink-300 hover:border-ink-600 hover:text-ink-100",
                      )}
                    >
                      <span className="block truncate font-medium">
                        No. {issue.number} · {issue.headline}
                      </span>
                      <span className={cn("block text-xs", issue.withdrawnAt ? "text-amber-300/80" : "text-ink-500")}>
                        {issue.withdrawnAt ? "withdrawn" : "on display"}
                        {issue.updatedAt ? " · corrected" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <div className="min-w-0">
          {!editing ? (
            <div className="glass-card p-8 text-ink-400">
              <p>Open a draft, or start a new one.</p>
              <p className="mt-2 text-sm text-ink-500">
                Put in only the words you mean to print. A story that spread across several journal entries can be
                gathered into one draft, a piece at a time, and nothing else from the journal comes with it.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-400">
                  {editing.kind === "issue" ? (
                    <>
                      Correcting <span className="text-ink-100">No. {editing.issue.number}</span>, printed{" "}
                      {when(editing.issue.publishedAt)}.{" "}
                      <a
                        href={townUrl(issuePath(editing.issue.number))}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 text-frost-300 underline underline-offset-2"
                      >
                        See it <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </>
                  ) : savedDraft ? (
                    <>Draft, last saved {when(savedDraft.updatedAt)}. Will print as No. {printsAs}.</>
                  ) : (
                    <>A new draft. Will print as No. {printsAs}.</>
                  )}
                </p>
                <div id="irr-tabs" role="tablist" aria-label="Write or preview" className="flex scroll-mt-24 rounded-xl border border-ink-700/50 p-0.5 text-sm">
                  {(["write", "preview"] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      role="tab"
                      aria-selected={tab === name}
                      onClick={() => {
                        setTab(name);
                        if (name === "preview") setPreviewed(true);
                      }}
                      className={cn(
                        "rounded-[0.6rem] px-4 py-1.5 capitalize transition-colors",
                        tab === name ? "bg-ink-800 text-ink-100" : "text-ink-500 hover:text-ink-200",
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {tab === "preview" ? (
                <div>
                  <p className="mb-3 text-sm text-frost-200/80">
                    Preview. Only you can see this, and it is set exactly as it will print.
                    {dirty && " It includes changes you haven’t saved yet."}
                  </p>
                  <IssueSheet
                    content={tidy}
                    number={printsAs}
                    updatedAt={editing.kind === "issue" ? (editing.issue.updatedAt ?? null) : null}
                    correction={editing.kind === "issue" ? note.trim() : undefined}
                    nav={false}
                    editor={data.editor}
                  />
                </div>
              ) : (
                <div className="glass-card space-y-5 p-5 md:p-6">
                  <div>
                    <label htmlFor="irr-headline" className={LABEL}>
                      Headline
                    </label>
                    <input
                      id="irr-headline"
                      value={content.headline}
                      maxLength={LIMITS.headline}
                      onChange={(e) => edit({ headline: e.target.value })}
                      placeholder="Two Men, Three Shoes, and a Troubling Amount of Tea"
                      className={cn(FIELD, "font-display text-lg")}
                    />
                  </div>
                  <div>
                    <label htmlFor="irr-standfirst" className={LABEL}>
                      Beneath the headline <span className="normal-case tracking-normal text-ink-500">(optional)</span>
                    </label>
                    <input
                      id="irr-standfirst"
                      value={content.standfirst}
                      maxLength={LIMITS.standfirst}
                      onChange={(e) => edit({ standfirst: e.target.value })}
                      className={FIELD}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[8rem_11rem_minmax(0,1fr)]">
                    <div>
                      <label htmlFor="irr-number" className={LABEL}>
                        Issue no.
                      </label>
                      {editing.kind === "issue" ? (
                        <p className="py-2 text-sm text-ink-300">No. {editing.issue.number}</p>
                      ) : (
                        <input
                          id="irr-number"
                          inputMode="numeric"
                          value={numberText}
                          onChange={(e) => {
                            setNumberText(e.target.value);
                            setConfirming(null);
                          }}
                          placeholder={`next: ${data.nextNumber}`}
                          className={FIELD}
                        />
                      )}
                    </div>
                    <div>
                      <label htmlFor="irr-date" className={LABEL}>
                        Dated
                      </label>
                      <input
                        id="irr-date"
                        type="date"
                        value={content.date}
                        onChange={(e) => edit({ date: e.target.value })}
                        className={cn(FIELD, "[color-scheme:dark]")}
                      />
                    </div>
                    <div>
                      <span className={LABEL}>Set as</span>
                      <div className="flex rounded-xl border border-ink-700/50 p-0.5 text-sm" role="radiogroup" aria-label="Layout">
                        {(
                          [
                            ["story", "One story"],
                            ["columns", "Separate pieces"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={content.layout === value}
                            onClick={() => edit({ layout: value })}
                            className={cn(
                              "flex-1 rounded-[0.6rem] px-3 py-1.5 transition-colors",
                              content.layout === value ? "bg-ink-800 text-ink-100" : "text-ink-500 hover:text-ink-200",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs text-ink-500">
                        Separate pieces sit in two columns on a wide screen. Phones always get one.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {content.pieces.map((piece, index) => (
                      <div key={index} className="rounded-xl border border-ink-700/40 bg-ink-950/30 p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                            {content.pieces.length === 1 ? "The story" : `Piece ${index + 1}`}
                          </span>
                          {content.pieces.length > 1 && (
                            <span className="flex items-center gap-1">
                              <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => movePiece(index, -1)} className="btn-ghost px-2 py-1 disabled:opacity-30">
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" aria-label="Move down" disabled={index === content.pieces.length - 1} onClick={() => movePiece(index, 1)} className="btn-ghost px-2 py-1 disabled:opacity-30">
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" aria-label="Remove this piece" onClick={() => removePiece(index)} className="btn-ghost px-2 py-1 hover:text-rose-300">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          )}
                        </div>
                        <input
                          aria-label={`Headline for ${content.pieces.length === 1 ? "the story" : `piece ${index + 1}`}`}
                          value={piece.headline}
                          maxLength={LIMITS.pieceHeadline}
                          onChange={(e) => editPiece(index, { headline: e.target.value })}
                          placeholder={content.pieces.length === 1 ? "Its own headline (optional)" : "Headline (optional)"}
                          className={cn(FIELD, "mb-3 font-display")}
                        />
                        <textarea
                          aria-label={`Words for ${content.pieces.length === 1 ? "the story" : `piece ${index + 1}`}`}
                          value={piece.body}
                          onChange={(e) => editPiece(index, { body: e.target.value })}
                          rows={content.pieces.length === 1 ? 18 : 9}
                          placeholder="Paste or write only what should be printed."
                          className={cn(FIELD, "font-display text-[0.95rem] leading-relaxed")}
                        />
                        <label className="mt-2 flex items-start gap-2 text-sm text-ink-400">
                          <input
                            type="checkbox"
                            checked={piece.alone}
                            onChange={(e) => editPiece(index, { alone: e.target.checked })}
                            className="mt-1 accent-[#b96f2c]"
                          />
                          <span>
                            Let it stand alone{" "}
                            <span className="text-ink-500">— full width, with room around it, and nothing beside it.</span>
                          </span>
                        </label>
                      </div>
                    ))}
                    {content.pieces.length < LIMITS.pieces && (
                      <button type="button" onClick={addPiece} className="btn-secondary py-2 text-sm">
                        Add a piece
                      </button>
                    )}
                    <p className="text-xs leading-relaxed text-ink-500">
                      A blank line starts a new paragraph, and single line breaks stay where you put them.{" "}
                      <code>*italic*</code> and <code>**bold**</code> work. A line of <code>* * *</code> is a pause,
                      and a line starting <code># </code> is a subheading.
                    </p>
                  </div>

                  {/* Not part of the sheet: what the coffeehouse's card quotes. */}
                  <div className="rounded-xl border border-ink-700/40 bg-ink-950/30 p-4">
                    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17.5rem] md:items-start">
                      <div>
                        <label htmlFor="irr-excerpt" className={LABEL}>
                          An excerpt for The Relay <span className="normal-case tracking-normal text-ink-500">(optional)</span>
                        </label>
                        <input
                          id="irr-excerpt"
                          value={excerpt}
                          maxLength={LIMITS.excerpt}
                          onChange={(e) => {
                            setExcerpt(e.target.value);
                            setConfirming(null);
                          }}
                          placeholder="“It doesn’t fold.”"
                          className={cn(FIELD, "font-display")}
                        />
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                          One short line from the issue, shown on The Relay’s front page with no explanation, exactly as
                          you type it. Left blank, the card shows the headline. It isn’t printed on the sheet, so
                          changing it later isn’t a correction and the issue isn’t marked as updated.
                        </p>
                        {editing.kind === "issue" && (
                          <button
                            type="button"
                            className="btn-secondary mt-3 py-1.5 text-sm disabled:opacity-40"
                            disabled={busy || !excerptChanged}
                            onClick={() => void saveExcerpt()}
                          >
                            {excerptChanged ? "Put it on the card" : "On the card"}
                          </button>
                        )}
                      </div>
                      <div>
                        <span className={cn(LABEL, "md:text-center")}>On The Relay</span>
                        <IrregularCard
                          link={false}
                          issue={{
                            number: printsAs,
                            date: tidy.date,
                            headline: tidy.headline || "Untitled",
                            excerpt: tidyExcerpt,
                          }}
                          className="mx-auto"
                        />
                      </div>
                    </div>
                  </div>

                  {editing.kind === "issue" && (
                    <div>
                      <label htmlFor="irr-note" className={LABEL}>
                        Correction note <span className="normal-case tracking-normal text-ink-500">(optional, printed beside “Updated”)</span>
                      </label>
                      <input
                        id="irr-note"
                        value={note}
                        maxLength={LIMITS.correction}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setConfirming(null);
                        }}
                        placeholder="The third shoe was a slipper."
                        className={FIELD}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* What would stop it printing, said before she tries. */}
              {problems.length > 0 && (
                <div className="text-sm text-amber-200/80">
                  <p className="mb-1 text-xs uppercase tracking-[0.12em] text-ink-500">Before it can print</p>
                  <ul className="space-y-1">
                    {problems.map((problem) => (
                      <li key={problem}>· {problem}</li>
                    ))}
                  </ul>
                </div>
              )}

              {message && (
                <div className={cn("text-sm", message.tone === "ok" ? "text-emerald-300/90" : "text-rose-300/90")}>
                  <p>{message.text}</p>
                  {message.problems?.map((problem) => (
                    <p key={problem}>· {problem}</p>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-ink-800 pt-4">
                {editing.kind === "draft" ? (
                  <>
                    <button type="button" className="btn-secondary py-2 text-sm" disabled={busy || !dirty} onClick={() => void save()}>
                      {dirty ? "Save draft" : "Saved"}
                    </button>
                    <button
                      type="button"
                      className="btn-primary py-2 text-sm disabled:opacity-40"
                      disabled={busy || dirty || !savedDraft || problems.length > 0}
                      title={dirty || !savedDraft ? "Save the draft first" : undefined}
                      onClick={() => setConfirming("publish")}
                    >
                      Send to press…
                    </button>
                    <button type="button" className="btn-ghost ml-auto text-sm" disabled={busy} onClick={() => setConfirming("discard")}>
                      Discard draft…
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-primary py-2 text-sm disabled:opacity-40"
                      disabled={busy || !dirty || problems.length > 0}
                      onClick={() => setConfirming("correct")}
                    >
                      Print the correction…
                    </button>
                    {editing.issue.withdrawnAt ? (
                      <button type="button" className="btn-secondary py-2 text-sm" disabled={busy} onClick={() => void setShown(editing.issue, false)}>
                        Put it back on display
                      </button>
                    ) : (
                      <button type="button" className="btn-ghost ml-auto text-sm hover:text-rose-200" disabled={busy} onClick={() => setConfirming("withdraw")}>
                        Withdraw it…
                      </button>
                    )}
                  </>
                )}
              </div>

              {confirming && (
                <div className="glass-card space-y-3 border-vb-500/30 p-4 text-sm text-ink-300">
                  {confirming === "publish" && (
                    <>
                      <p>
                        Print this as <span className="text-ink-100">No. {printsAs}</span>? It appears at{" "}
                        <span className="font-mono text-ink-200">{townUrl(issuePath(printsAs))}</span>, at the gate, on
                        The Relay’s front page, and in the archive, all at once.
                      </p>
                      {!previewed && <p className="text-amber-200/90">You haven’t looked at the preview of this version.</p>}
                    </>
                  )}
                  {confirming === "discard" && <p>Throw this draft away? It was never printed, and it can’t be brought back.</p>}
                  {confirming === "correct" && editing.kind === "issue" && (
                    <>
                      <p>
                        Replace the words of No. {editing.issue.number}? Its address stays the same, the page says it
                        was updated, and the old wording is not kept.
                      </p>
                      {!previewed && <p className="text-amber-200/90">You haven’t looked at the preview of this correction.</p>}
                    </>
                  )}
                  {confirming === "withdraw" && editing.kind === "issue" && (
                    <p>
                      Take No. {editing.issue.number} off display? Its page and its place in the archive will say only
                      that it was withdrawn, and it leaves the gate and The Relay’s front page until you put it back.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(confirming === "publish" || confirming === "correct") && (
                      <button
                        type="button"
                        className={cn(previewed ? "btn-ghost" : "btn-primary", "py-1.5 text-sm")}
                        onClick={() => {
                          setTab("preview");
                          setPreviewed(true);
                          document.getElementById("irr-tabs")?.scrollIntoView({ block: "start" });
                        }}
                      >
                        {previewed ? "See the preview again" : "Look at the preview first"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={cn(
                        (confirming === "publish" || confirming === "correct") && !previewed ? "btn-secondary" : "btn-primary",
                        "py-1.5 text-sm",
                      )}
                      disabled={busy}
                      onClick={() => {
                        if (confirming === "publish") void publish();
                        else if (confirming === "discard") void discard();
                        else if (confirming === "correct") void correct();
                        else if (confirming === "withdraw" && editing.kind === "issue") void setShown(editing.issue, true);
                      }}
                    >
                      {confirming === "publish"
                        ? "Print it"
                        : confirming === "discard"
                          ? "Discard it"
                          : confirming === "correct"
                            ? "Print the correction"
                            : "Withdraw it"}
                    </button>
                    <button type="button" className="btn-ghost text-sm" onClick={() => setConfirming(null)}>
                      Not yet
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
