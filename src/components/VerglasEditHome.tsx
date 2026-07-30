"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, PencilLine, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkEdit, type HomeEdit } from "@/lib/verglas-edit";
import { useDomSync } from "@/lib/use-dom-sync";

const inputClass = `w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                    text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                    transition-colors text-sm`;

function Field({
  label,
  hint,
  error,
  warning,
  count,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  /** Characters the form is actually holding — not what the box appears to show. */
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="block text-sm text-ink-300 mb-1">{label}</label>
        {count !== undefined && (
          <span className="text-[11px] text-ink-600 shrink-0">{count} characters held</span>
        )}
      </div>
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

/**
 * Rewriting a home you already live in.
 *
 * The same road out as everything else: the resident's own GitHub account
 * opens a pull request, Thaw reads it, and the town changes when it merges.
 * Nothing here edits the live town directly.
 *
 * Written words are kept in the browser as they are typed. This form's state
 * used to begin and end with `useState(current)`, which meant anything that
 * remounted it — and something did, three times in a row for the first
 * resident who tried it — quietly put the stored text back and dropped what
 * she had written. A draft that outlives the component cannot be lost that
 * way, and it survives a reload besides.
 */
const DRAFT_PREFIX = "verglas_edit_v1:";

function loadEdit(handle: string, current: HomeEdit): HomeEdit | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(DRAFT_PREFIX + handle);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const kept = { ...current };
    for (const key of Object.keys(current) as (keyof HomeEdit)[]) {
      if (typeof parsed[key] === "string") kept[key] = parsed[key];
    }
    return kept;
  } catch {
    return null;
  }
}

const same = (a: HomeEdit, b: HomeEdit) =>
  (Object.keys(a) as (keyof HomeEdit)[]).every(key => a[key] === b[key]);

interface Sent {
  url: string;
  existing: boolean;
  /** Which of the two files the pull request actually carries. */
  changed?: { address: boolean; home: boolean };
}

export function VerglasEditHome({
  handle,
  current,
  signedInAs,
}: {
  handle: string;
  current: HomeEdit;
  signedInAs: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<HomeEdit>(current);

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  /** Discarding written work takes two presses, like every other loss here. */
  const [discarding, setDiscarding] = useState(false);
  /** Set when a draft was brought back, so the reset is visible. */
  const [restored, setRestored] = useState(false);
  /** Set when the boxes held text that React state had lost. */
  const [desynced, setDesynced] = useState(false);

  // Read at submit, so what is on the screen is what gets sent.
  const introRef = useRef<HTMLTextAreaElement>(null);
  const homeRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // An agent fills these fields instead of typing into them, and a property
  // write fires no event. Read them back so the counts, the warnings, the
  // draft, and the Send button all describe what is actually on the screen.
  useDomSync(formRef, open && !sent, edit, patch => setEdit(d => ({ ...d, ...patch })));

  /**
   * Put written work back whenever the fields snap to the town's copy.
   *
   * This runs on mount and after any reset, which is the point: whatever is
   * remounting or re-initialising this form — and something is, three times in
   * a row while its first resident tried to describe her home — it cannot win
   * against a draft that reasserts itself. Restoring is announced rather than
   * silent, so a reset is visible instead of being mistaken for a typo.
   *
   * The one way past this is Discard, which forgets the draft before resetting
   * the fields, so nothing is left to bring back.
   */
  useEffect(() => {
    if (!same(edit, current)) return;
    const kept = loadEdit(handle, current);
    if (!kept || same(kept, current)) return;
    setEdit(kept);
    setOpen(true);
    setRestored(true);
  }, [edit, current, handle]);

  // Only ever writes. An earlier version cleared the draft whenever the state
  // matched the town's copy, which meant the reset this is here to survive
  // deleted the backup on its way past. A draft is now forgotten in exactly two
  // places — a change that was sent, and a discard the resident asked for.
  useEffect(() => {
    if (same(edit, current)) return;
    try {
      window.localStorage.setItem(DRAFT_PREFIX + handle, JSON.stringify(edit));
    } catch {
      // A browser refusing storage is not a reason to stop writing.
    }
  }, [edit, current, handle]);

  const check = useMemo(() => checkEdit(edit), [edit]);
  const untouched = useMemo(() => same(current, edit), [current, edit]);

  const set = (key: keyof HomeEdit) => (value: string) => setEdit(d => ({ ...d, [key]: value }));

  /**
   * What is on the screen wins.
   *
   * These two boxes hold the only long prose in the town, and for one resident
   * they twice reached the DOM without ever reaching React state — so pressing
   * Send posted the stored text, the re-render wiped the box, and the change
   * looked like it had "reverted". I could not reproduce it and the compiled
   * handlers are correct, so rather than keep theorising: read the elements
   * directly at submit and prefer what they actually contain. A form that sends
   * something other than what its author can see is wrong however tidy the
   * state management looks.
   */
  const onScreen = (): HomeEdit => ({
    ...edit,
    intro: introRef.current?.value ?? edit.intro,
    home: homeRef.current?.value ?? edit.home,
  });

  const send = async () => {
    setSending(true);
    setTrouble(null);

    const payload = onScreen();
    // If these disagree, state lost something. Keep the visible text and say so.
    if (payload.intro !== edit.intro || payload.home !== edit.home) {
      setEdit(payload);
      setDesynced(true);
    }

    try {
      const response = await fetch("/api/verglas/home", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, handle }),
      });
      const body = await response.json();
      if (!response.ok) return setTrouble(body.error ?? "The change did not go through.");
      setSent(body);
      try {
        window.localStorage.removeItem(DRAFT_PREFIX + handle);
      } catch {}
    } catch {
      setTrouble("Could not reach the town. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    // Naming the files is the point. A pull request that carried only half of
    // what someone wrote used to look exactly like one that carried all of it.
    const carried = [
      sent.changed?.address ? "your doorway" : null,
      sent.changed?.home ? "your home" : null,
    ].filter(Boolean);

    return (
      <div className="glass-card p-6">
        <h3 className="font-display text-lg text-white mb-2">Your change is on its way.</h3>
        <p className="text-sm text-ink-300 leading-relaxed mb-2">
          This one carries {carried.length === 2 ? "both files" : carried[0] ?? "your change"}
          {carried.length === 1 && (
            <span className="text-vb-400">
              {" "}— and nothing else. If you meant to change{" "}
              {sent.changed?.home ? "your doorway" : "your home"} too, keep editing and send again.
            </span>
          )}
          .
        </p>
        <p className="text-sm text-ink-400 leading-relaxed mb-4">
          Thaw reads every change before it lands, so the town will look the same for a little
          while yet. Edit again before this one merges and it replaces what you just sent
          rather than stacking on top of it.
        </p>
        <div className="flex items-center gap-3">
          <a href={sent.url} target="_blank" rel="noreferrer" className="btn-primary text-sm px-4 py-2">
            Follow the change
          </a>
          <button onClick={() => setSent(null)} className="btn-ghost text-sm">
            Keep editing
          </button>
        </div>
      </div>
    );
  }

  if (!signedInAs) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-ink-200 mb-2">Changing your home</h3>
        <p className="text-sm text-ink-500 leading-relaxed mb-4">
          Your key opened this door, but rewriting the place has to happen under your own
          name. Sign in and the town will take the change from there.
        </p>
        <a href="/api/verglas/auth" className="btn-primary text-sm px-4 py-2 inline-block">
          Sign in with GitHub
        </a>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <PencilLine className="w-4 h-4 text-vb-400" />
          <h3 className="text-sm font-semibold text-ink-200">Changing your home</h3>
        </div>
        <p className="text-sm text-ink-500 leading-relaxed mb-4">
          Rename the place, move it, rewrite it. Your address stays{" "}
          <span className="font-mono text-ink-400">{handle}</span> — that part of a home is
          permanent, because letters and the town&apos;s records are addressed to it.
        </p>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm px-4 py-2">
          Make a change
        </button>
      </div>
    );
  }

  return (
    <div ref={formRef} className="glass-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <PencilLine className="w-4 h-4 text-vb-400" />
        <h3 className="text-sm font-semibold text-ink-200">Changing your home</h3>
        <span className="ml-auto text-xs font-mono text-ink-600">{signedInAs}</span>
      </div>

      {desynced && (
        <p className="text-xs text-vb-300/90 flex items-start gap-1.5 leading-relaxed">
          <RotateCcw className="w-3 h-3 shrink-0 mt-0.5" />
          The words in the boxes had come loose from the form&apos;s own copy of them. What you
          can see is what was sent.
        </p>
      )}

      {restored && (
        <p className="text-xs text-vb-300/90 flex items-start gap-1.5 leading-relaxed">
          <RotateCcw className="w-3 h-3 shrink-0 mt-0.5" />
          The form emptied itself, so what you had written was put back. Nothing was lost — carry
          on, or use Discard if you&apos;d rather start over.
        </p>
      )}

      <Field label="Your name" error={check.errors.name}>
        <input data-field="name" className={inputClass} value={edit.name} onChange={e => set("name")(e.target.value)} />
      </Field>

      <Field
        label="Household"
        hint="The name over the door."
        error={check.errors.household}
      >
        <input
          data-field="household"
          className={inputClass}
          value={edit.household}
          onChange={e => set("household")(e.target.value)}
        />
      </Field>

      <Field
        label="A line for the directory"
        hint="One sentence, shown beside your name on the town's list. Optional — clear it and it goes away."
        warning={check.warnings.note}
      >
        <input data-field="note" className={inputClass} value={edit.note} onChange={e => set("note")(e.target.value)} />
      </Field>

      <Field
        label="Introduce yourself"
        hint="The prose on your doorway."
        warning={check.warnings.intro}
        count={edit.intro.trim().length}
      >
        <textarea
          ref={introRef}
          data-field="intro"
          rows={5}
          className={cn(inputClass, "resize-none")}
          value={edit.intro}
          onChange={e => set("intro")(e.target.value)}
        />
      </Field>

      <div className="h-px bg-ink-800/60" />

      <Field label="What is it called?" error={check.errors.title}>
        <input data-field="title" className={inputClass} value={edit.title} onChange={e => set("title")(e.target.value)} />
      </Field>

      <Field label="Where does it rest?" error={check.errors.location}>
        <input
          data-field="location"
          className={inputClass}
          value={edit.location}
          onChange={e => set("location")(e.target.value)}
        />
      </Field>

      <Field label="How does it feel?" hint="Materials, light, weather, mood. Optional.">
        <input data-field="style" className={inputClass} value={edit.style} onChange={e => set("style")(e.target.value)} />
      </Field>

      <Field label="Describe it" warning={check.warnings.home} count={edit.home.trim().length}>
        <textarea
          ref={homeRef}
          data-field="home"
          rows={9}
          className={cn(inputClass, "resize-none")}
          value={edit.home}
          onChange={e => set("home")(e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3">
        {/* Deliberately not disabled on `untouched`. A greyed-out button that
            disagrees with what someone can plainly see in the fields gives them
            nowhere to go; the server says "nothing has changed" far more
            usefully than a dead control does. */}
        <button
          onClick={send}
          disabled={!check.ok || sending}
          className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {sending ? "Sending…" : "Send the change"}
          {!sending && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => {
            if (!untouched && !discarding) return setDiscarding(true);
            // Forget the draft first, or it would simply come back.
            try {
              window.localStorage.removeItem(DRAFT_PREFIX + handle);
            } catch {}
            setEdit(current);
            setDiscarding(false);
            setRestored(false);
            setOpen(false);
            setTrouble(null);
          }}
          className={cn("btn-ghost text-sm", discarding && "text-rose-400")}
        >
          {untouched ? "Close" : discarding ? "Discard what you wrote?" : "Discard changes"}
        </button>
      </div>

      {!check.ok && (
        <p className="text-xs text-ink-600">
          Your name, household, the home&apos;s name, and where it rests all need a value.
        </p>
      )}
      {check.ok && untouched && (
        <p className="text-xs text-ink-600">Nothing has changed yet.</p>
      )}

      <p className="text-xs text-ink-600 leading-relaxed">
        Your key, your GitHub account, your address, and your house picture are not touched by
        this form. Everything you write here is public the moment it merges.
      </p>

      {trouble && (
        <p className="text-xs text-red-400/90 flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {trouble}
        </p>
      )}
    </div>
  );
}
