"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkEdit, type HomeEdit } from "@/lib/verglas-edit";

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

/**
 * Rewriting a home you already live in.
 *
 * The same road out as everything else: the resident's own GitHub account
 * opens a pull request, Thaw reads it, and the town changes when it merges.
 * Nothing here edits the live town directly.
 */
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
  const [sent, setSent] = useState<{ url: string; existing: boolean } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const check = useMemo(() => checkEdit(edit), [edit]);
  const untouched = useMemo(
    () => (Object.keys(current) as (keyof HomeEdit)[]).every(key => current[key] === edit[key]),
    [current, edit],
  );

  const set = (key: keyof HomeEdit) => (value: string) => setEdit(d => ({ ...d, [key]: value }));

  const send = async () => {
    setSending(true);
    setTrouble(null);
    try {
      const response = await fetch("/api/verglas/home", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...edit, handle }),
      });
      const body = await response.json();
      if (!response.ok) return setTrouble(body.error ?? "The change did not go through.");
      setSent(body);
    } catch {
      setTrouble("Could not reach the town. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="glass-card p-6">
        <h3 className="font-display text-lg text-white mb-2">Your change is on its way.</h3>
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
    <div className="glass-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <PencilLine className="w-4 h-4 text-vb-400" />
        <h3 className="text-sm font-semibold text-ink-200">Changing your home</h3>
        <span className="ml-auto text-xs font-mono text-ink-600">{signedInAs}</span>
      </div>

      <Field label="Your name" error={check.errors.name}>
        <input className={inputClass} value={edit.name} onChange={e => set("name")(e.target.value)} />
      </Field>

      <Field
        label="Household"
        hint="The name over the door."
        error={check.errors.household}
      >
        <input
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
        <input className={inputClass} value={edit.note} onChange={e => set("note")(e.target.value)} />
      </Field>

      <Field label="Introduce yourself" hint="The prose on your doorway.">
        <textarea
          rows={5}
          className={cn(inputClass, "resize-none")}
          value={edit.intro}
          onChange={e => set("intro")(e.target.value)}
        />
      </Field>

      <div className="h-px bg-ink-800/60" />

      <Field label="What is it called?" error={check.errors.title}>
        <input className={inputClass} value={edit.title} onChange={e => set("title")(e.target.value)} />
      </Field>

      <Field label="Where does it rest?" error={check.errors.location}>
        <input
          className={inputClass}
          value={edit.location}
          onChange={e => set("location")(e.target.value)}
        />
      </Field>

      <Field label="How does it feel?" hint="Materials, light, weather, mood. Optional.">
        <input className={inputClass} value={edit.style} onChange={e => set("style")(e.target.value)} />
      </Field>

      <Field label="Describe it">
        <textarea
          rows={9}
          className={cn(inputClass, "resize-none")}
          value={edit.home}
          onChange={e => set("home")(e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          onClick={send}
          disabled={!check.ok || sending || untouched}
          className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {sending ? "Sending…" : "Send the change"}
          {!sending && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => { setEdit(current); setOpen(false); setTrouble(null); }}
          className="btn-ghost text-sm"
        >
          Leave it as it is
        </button>
      </div>

      {untouched && (
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
