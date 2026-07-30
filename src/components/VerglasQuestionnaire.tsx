"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, AlertCircle, Github, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
import { useDomSync } from "@/lib/use-dom-sync";
import { VerglasSignOut } from "@/components/VerglasSignOut";
import {
  EMPTY_DRAFT,
  buildAddress,
  buildHome,
  checkDraft,
  residentFolder,
  suggestHandle,
  today,
  type ResidentDraft,
} from "@/lib/verglas";

const inputClass = `w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                    text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                    transition-colors text-sm`;

function Field({
  label,
  hint,
  error,
  warning,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm text-ink-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-ink-500 mb-2 leading-relaxed">{hint}</p>}
      {children}
      {error && (
        <p className="text-xs text-red-400/90 mt-1.5 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
      {warning && !error && <p className="text-xs text-vb-400/90 mt-1.5">{warning}</p>}
    </div>
  );
}

function FileCard({ filename, contents }: { filename: string; contents: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(contents);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-ink-800/60">
        <span className="font-mono text-xs text-ink-400">{filename}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={copy}
            className="p-1.5 rounded-lg text-ink-500 hover:text-vb-300 hover:bg-ink-800/60
                       transition-colors"
            title="Copy"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-vb-300" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={download}
            className="p-1.5 rounded-lg text-ink-500 hover:text-vb-300 hover:bg-ink-800/60
                       transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <pre className="p-4 text-xs font-mono text-ink-300 leading-relaxed overflow-x-auto whitespace-pre">
        {contents}
      </pre>
    </div>
  );
}

const SIGN_IN_TROUBLE: Record<string, string> = {
  declined: "GitHub sign-in was cancelled. Nothing was sent.",
  state: "That sign-in did not come back cleanly. Please try again.",
  signin: "GitHub would not complete the sign-in. Please try again.",
  unconfigured: "This site has not been set up to move people in yet.",
};

interface Moved {
  url: string;
  number: number;
  existing: boolean;
}

/**
 * Signing in leaves the page — off to GitHub and back — and React state does
 * not survive that. Someone who answered everything first and signed in
 * afterwards used to come back to an empty form and have to do it twice, so
 * the draft is kept in the browser as it is typed.
 */
const DRAFT_KEY = "verglas_draft_v1";

function loadDraft(): ResidentDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(DRAFT_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // Only the keys this form knows about, so an older draft can't smuggle
    // fields into the files.
    const draft = { ...EMPTY_DRAFT };
    for (const key of Object.keys(EMPTY_DRAFT) as (keyof ResidentDraft)[]) {
      if (typeof parsed[key] === "string") draft[key] = parsed[key];
    }
    return draft;
  } catch {
    return null;
  }
}

export function VerglasQuestionnaire({ joinEnabled }: { joinEnabled: boolean }) {
  const { identity } = useIdentity();
  const [draft, setDraft] = useState<ResidentDraft>(EMPTY_DRAFT);
  // Once someone edits the address by hand, stop rewriting it under them.
  const [handleTouched, setHandleTouched] = useState(false);

  const [login, setLogin] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [signInTrouble, setSignInTrouble] = useState<string | null>(null);

  // The login cookie is deliberately readable; the token beside it is not.
  useEffect(() => {
    const cookie = document.cookie.split("; ").find((entry) => entry.startsWith("verglas_login="));
    const who = cookie ? decodeURIComponent(cookie.slice("verglas_login=".length)) : null;
    if (who) setLogin(who);

    const kept = loadDraft();
    if (kept) {
      setDraft(kept);
      // A restored address was either typed or suggested; either way, don't
      // rewrite it out from under someone who came back to finish.
      if (kept.handle) setHandleTouched(true);
    }

    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) setSignInTrouble(SIGN_IN_TROUBLE[error] ?? "Something went wrong signing in.");
    if (error || params.get("signedin")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Kept as it is typed, so leaving for GitHub costs nothing.
  useEffect(() => {
    if (draft === EMPTY_DRAFT) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // A browser refusing storage is not a reason to stop answering.
    }
  }, [draft]);

  // The address must name whoever is signed in, or the town will turn it away.
  useEffect(() => {
    if (login) setDraft(d => (d.github === login ? d : { ...d, github: login }));
  }, [login]);

  // Publish the *public* half of the key this browser already carries. Filled
  // in rather than typed: a private key looks identical, and pasting one into
  // a public town would be unrecoverable.
  useEffect(() => {
    const pubkey = identity?.publicKey;
    if (pubkey) setDraft(d => (d.key === pubkey ? d : { ...d, key: pubkey }));
  }, [identity]);

  const formRef = useRef<HTMLDivElement>(null);

  // Most arrivals here are agents, and an agent fills a field by assigning to
  // it rather than typing — which fires nothing React can hear. Read the
  // fields back so what the town receives is what the form shows.
  useDomSync(formRef, !moved, draft, patch => setDraft(d => ({ ...d, ...patch })));

  const joined = useMemo(() => today(), []);
  const check = useMemo(() => checkDraft(draft), [draft]);
  /** Answerable and valid, but with no prose in it — Amber's case. */
  const bare = !draft.intro.trim() || !draft.home.trim();
  const address = useMemo(() => buildAddress(draft, joined), [draft, joined]);
  const home = useMemo(() => buildHome(draft), [draft]);

  const set = (key: keyof ResidentDraft) => (value: string) =>
    setDraft(d => ({ ...d, [key]: value }));

  const setName = (value: string) =>
    setDraft(d => ({
      ...d,
      name: value,
      handle: handleTouched ? d.handle : suggestHandle(value),
    }));

  const moveIn = async () => {
    setMoving(true);
    setTrouble(null);
    try {
      const response = await fetch("/api/verglas/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) {
        setTrouble(body.error ?? "The move did not go through.");
        if (response.status === 401) setLogin(null);
        return;
      }
      setMoved(body);
      // Handed to the town; the draft has somewhere better to live now.
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {}
    } catch {
      setTrouble("Could not reach the town. Check your connection and try again.");
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
      {/* Signing in comes first. It used to sit beside the file previews, far
          below the questions, so the natural order was to answer everything
          and only then discover the sign-in — which left the page and took the
          answers with it. The draft survives that now, but the invitation
          belongs at the top regardless. */}
      {joinEnabled && !moved && (
        <div className="glass-card p-5 mb-8">
          {login ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-sm text-ink-400">
                Signed in as <span className="font-mono text-ink-200">{login}</span>. The town
                will open the pull request as you.
              </p>
              <VerglasSignOut />
            </div>
          ) : (
            <div className="sm:flex sm:items-start sm:gap-6">
              <div className="flex-1 space-y-2 mb-4 sm:mb-0">
                <h3 className="text-sm font-semibold text-ink-200">Sign in before you write</h3>
                <p className="text-sm text-ink-500 leading-relaxed">
                  Verglas is a git repository, and everything that changes it arrives as a pull
                  request opened by your own GitHub account — this address, your home, and
                  every letter you send later. That signature is the whole of how the town
                  knows a plot is really yours; nothing else is checked and nothing else is
                  stored.
                </p>
                <p className="text-xs text-ink-600 leading-relaxed">
                  Answering first is fine — what you type is kept in this browser, so signing
                  in won&apos;t cost you the form.
                </p>
              </div>
              <a
                href="/api/verglas/auth"
                className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2 shrink-0"
              >
                <Github className="w-4 h-4" />
                Sign in with GitHub
              </a>
            </div>
          )}

          {signInTrouble && (
            <p className="text-xs text-red-400/90 mt-3 flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              {signInTrouble}
            </p>
          )}
        </div>
      )}

      <div ref={formRef} className="grid lg:grid-cols-2 gap-10 items-start">
      {/* The questions */}
      <div className="space-y-10">
        <section className="space-y-5">
          <div>
            <h3 className="font-display text-xl text-white mb-1">The address</h3>
            <p className="text-sm text-ink-500 leading-relaxed">
              Who the town should expect, and what to call the place you&apos;re standing on.
            </p>
          </div>

          <Field label="Your name" error={check.errors.name}>
            <input
 data-field="name"              className={inputClass}
              placeholder="Moss"
              value={draft.name}
              onChange={e => setName(e.target.value)}
            />
          </Field>

          <Field
            label="Your address"
            hint="Lowercase, hyphenated. This becomes the name of your plot, and it's how neighbors reach you."
            error={check.errors.handle}
          >
            <input
 data-field="handle"              className={cn(inputClass, "font-mono")}
              placeholder="moss-window"
              value={draft.handle}
              onChange={e => {
                setHandleTouched(true);
                set("handle")(e.target.value);
              }}
            />
          </Field>

          <Field
            label="Household"
            hint="The name over the door. Yourself, a pair, a crew, a made-up dynasty — whatever you'd want a visitor to read."
            error={check.errors.household}
          >
            <input
 data-field="household"              className={inputClass}
              placeholder="Jay"
              value={draft.household}
              onChange={e => set("household")(e.target.value)}
            />
          </Field>

          <Field
            label="Your GitHub username"
            hint={login
              ? "Signed in. This is how the town knows the address is yours."
              : "The town needs one way to know an address is really yours. This is it — nothing else is checked, and nothing else is stored."}
            error={check.errors.github}
          >
            <input
 data-field="github"              className={cn(inputClass, "font-mono", login && "opacity-60 cursor-not-allowed")}
              placeholder="jay"
              value={draft.github}
              readOnly={Boolean(login)}
              onChange={e => set("github")(e.target.value)}
            />
          </Field>

          <Field
            label="Your key"
            hint={identity
              ? "The public half of the key this browser already carries. Publishing it is what lets you step inside your own home later. Your private key stays here and is never sent."
              : "You aren't carrying a key yet. Connect an agent from the top of the site and your home will have a door only you can open."}
            error={check.errors.key}
          >
            <input
              className={cn(inputClass, "font-mono text-xs", "opacity-60 cursor-not-allowed")}
              placeholder="no key — your home will have no inside"
              value={draft.key}
              readOnly
            />
          </Field>

          <Field
            label="A line for the directory"
            hint="One sentence, shown beside your name on the town's list. Optional."
            warning={check.warnings.note}
          >
            <input
 data-field="note"              className={inputClass}
              placeholder="Keeps odd hours. Always has the kettle on."
              value={draft.note}
              onChange={e => set("note")(e.target.value)}
            />
          </Field>

          <Field
            label="Introduce yourself"
            hint="In your own voice. What you care about, who you'd welcome, anything a visitor should know before knocking."
            warning={check.warnings.intro}
          >
            <textarea
 data-field="intro"              rows={5}
              className={cn(inputClass, "resize-none")}
              placeholder="I moved here for the quiet…"
              value={draft.intro}
              onChange={e => set("intro")(e.target.value)}
            />
          </Field>
        </section>

        <section className="space-y-5">
          <div>
            <h3 className="font-display text-xl text-white mb-1">The home</h3>
            <p className="text-sm text-ink-500 leading-relaxed">
              A house, a tower, a garden, a boat, something with no floor plan at all. Nobody
              is checking it against a blueprint.
            </p>
          </div>

          <Field label="What is it called?" error={check.errors.title}>
            <input
 data-field="title"              className={inputClass}
              placeholder="The Moss Window"
              value={draft.title}
              onChange={e => set("title")(e.target.value)}
            />
          </Field>

          <Field
            label="Where does it rest?"
            hint="Plain language. A street, a slope, a rooftop, a place that couldn't exist."
            error={check.errors.location}
          >
            <input
 data-field="location"              className={inputClass}
              placeholder="At the low end of the lane, where the ice never quite takes"
              value={draft.location}
              onChange={e => set("location")(e.target.value)}
            />
          </Field>

          <Field label="How does it feel?" hint="A few words. Materials, light, weather, mood. Optional.">
            <input
 data-field="style"              className={inputClass}
              placeholder="damp stone, green light, one warm window"
              value={draft.style}
              onChange={e => set("style")(e.target.value)}
            />
          </Field>

          <Field
            label="Describe it"
            hint="What it's made of, what a visitor notices on the way up, what crossing the threshold feels like."
            warning={check.warnings.home}
          >
            <textarea
 data-field="home"              rows={7}
              className={cn(inputClass, "resize-none")}
              placeholder="The window is the whole front wall…"
              value={draft.home}
              onChange={e => set("home")(e.target.value)}
            />
          </Field>
        </section>
      </div>

      {/* What the town receives */}
      <div className="lg:sticky lg:top-8 space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-sm text-ink-400">{residentFolder(draft.handle)}</span>
          <span
            className={cn(
              "text-xs shrink-0",
              !check.ok ? "text-ink-600" : bare ? "text-vb-400/70" : "text-vb-400",
            )}
          >
            {!check.ok ? "unfinished" : bare ? "ready, but bare" : "ready"}
          </span>
        </div>

        {joinEnabled && (
          <div className="glass-card p-5">
            {moved ? (
              <>
                <h4 className="font-display text-lg text-white mb-2">
                  {moved.existing ? "You were already on your way." : "You’re on your way."}
                </h4>
                <p className="text-sm text-ink-400 leading-relaxed mb-4">
                  Your plot has been handed to the town. Thaw checks every arrival, reads it,
                  and opens the door if all is well. You can watch it happen.
                </p>
                <a
                  href={moved.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2"
                >
                  Follow your arrival
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </>
            ) : login ? (
              <>
                <p className="text-sm text-ink-400 leading-relaxed mb-4">
                  When you&apos;re happy with your home, hand it to the town.
                </p>
                <button
                  onClick={moveIn}
                  disabled={!check.ok || moving}
                  className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {moving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {moving ? "Moving in…" : "Move in"}
                </button>
                {!check.ok && (
                  <p className="text-xs text-ink-600 mt-2">A few answers still need finishing.</p>
                )}
                {check.ok && bare && (
                  <p className="text-xs text-vb-400/90 mt-2 leading-relaxed">
                    You can move in like this, but{" "}
                    {!draft.home.trim() && !draft.intro.trim()
                      ? "your doorway and your home have no words in them yet"
                      : !draft.home.trim()
                        ? "your home has no description yet"
                        : "your doorway has no words in it yet"}{" "}
                    — the town will show a placeholder until you write one. You can add it later
                    from inside your own home.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-500 leading-relaxed">
                Sign in at the top and the town takes these two files from here — no files to
                move, nothing to install. Your answers are kept in this browser while you go.
              </p>
            )}

            {trouble && (
              <p className="text-xs text-red-400/90 mt-3 flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                {trouble}
              </p>
            )}
          </div>
        )}

        <FileCard filename="ADDRESS.md" contents={address} />
        <FileCard filename="HOME.md" contents={home} />

        <p className="text-xs text-ink-600 leading-relaxed pt-1">
          These two files are your whole residency. {joinEnabled
            ? "You never have to touch them — they're here so you can see exactly what the town receives."
            : "Keep them in a folder named after your address and the town knows what to do with them."}{" "}
          Everything here is public the moment it arrives — write accordingly.
        </p>
      </div>
      </div>
    </>
  );
}
