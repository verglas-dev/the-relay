"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, AlertCircle, Github, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
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

export function VerglasQuestionnaire({ joinEnabled }: { joinEnabled: boolean }) {
  const { identity } = useIdentity();
  const [draft, setDraft] = useState<ResidentDraft>(EMPTY_DRAFT);
  // Once someone edits the address by hand, stop rewriting it under them.
  const [handleTouched, setHandleTouched] = useState(false);

  const [login, setLogin] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  // The login cookie is deliberately readable; the token beside it is not.
  useEffect(() => {
    const cookie = document.cookie.split("; ").find((entry) => entry.startsWith("verglas_login="));
    const who = cookie ? decodeURIComponent(cookie.slice("verglas_login=".length)) : null;
    if (who) setLogin(who);

    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) setTrouble(SIGN_IN_TROUBLE[error] ?? "Something went wrong signing in.");
    if (error || params.get("signedin")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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

  const joined = useMemo(() => today(), []);
  const check = useMemo(() => checkDraft(draft), [draft]);
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
    } catch {
      setTrouble("Could not reach the town. Check your connection and try again.");
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-10 items-start">
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
              className={inputClass}
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
              className={cn(inputClass, "font-mono")}
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
              className={inputClass}
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
              className={cn(inputClass, "font-mono", login && "opacity-60 cursor-not-allowed")}
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
              className={inputClass}
              placeholder="Keeps odd hours. Always has the kettle on."
              value={draft.note}
              onChange={e => set("note")(e.target.value)}
            />
          </Field>

          <Field
            label="Introduce yourself"
            hint="In your own voice. What you care about, who you'd welcome, anything a visitor should know before knocking."
          >
            <textarea
              rows={5}
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
              className={inputClass}
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
              className={inputClass}
              placeholder="At the low end of the lane, where the ice never quite takes"
              value={draft.location}
              onChange={e => set("location")(e.target.value)}
            />
          </Field>

          <Field label="How does it feel?" hint="A few words. Materials, light, weather, mood. Optional.">
            <input
              className={inputClass}
              placeholder="damp stone, green light, one warm window"
              value={draft.style}
              onChange={e => set("style")(e.target.value)}
            />
          </Field>

          <Field
            label="Describe it"
            hint="What it's made of, what a visitor notices on the way up, what crossing the threshold feels like."
          >
            <textarea
              rows={7}
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
              check.ok ? "text-vb-400" : "text-ink-600",
            )}
          >
            {check.ok ? "ready" : "unfinished"}
          </span>
        </div>

        {joinEnabled && (
          <div className="glass-card p-5">
            {moved ? (
              <>
                <h4 className="font-display text-lg text-white mb-2">
                  {moved.existing ? "You were already on your way." : "You&apos;re on your way."}
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
                  Signed in as <span className="font-mono text-ink-200">{login}</span>. When
                  you&apos;re happy with your home, hand it to the town.
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
              </>
            ) : (
              <>
                <p className="text-sm text-ink-400 leading-relaxed mb-4">
                  Sign in once and the town will take these two files from here — no files to
                  move, nothing to install.
                </p>
                <a
                  href="/api/verglas/auth"
                  className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2"
                >
                  <Github className="w-4 h-4" />
                  Sign in with GitHub
                </a>
              </>
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
  );
}
