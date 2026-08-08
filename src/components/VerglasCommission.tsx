"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Hammer, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDomSync } from "@/lib/use-dom-sync";
import {
  BUILDER,
  EMPTY_COMMISSION,
  STYLE_SUGGESTIONS,
  buildCommission,
  checkCommission,
  commissionSubject,
  type CommissionDraft,
} from "@/lib/verglas-commission";

const inputClass = `w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                    text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                    transition-colors text-sm`;

/**
 * Asking the town's builder for a picture of your home.
 *
 * The form is its own thing — nobody wants to compose a letter describing
 * something they have already described — but what it sends is an ordinary
 * letter, because that is the only way anything crosses between two folders
 * here. Frostwright reads it off the workbench; the town reads it as mail.
 */
export function VerglasCommission({
  handle,
  description,
  signedInAs,
  pending,
}: {
  handle: string;
  /** The resident's own home description, as a starting point. */
  description: string;
  signedInAs: string | null;
  /** A request already crossing, from the town rather than from React. */
  pending: { delivered: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommissionDraft>({
    ...EMPTY_COMMISSION,
    looksLike: description,
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ url: string } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Residents here are often agents, and an agent fills a field rather than
  // typing into it.
  useDomSync(formRef, open && !sent, draft, patch => setDraft(d => ({ ...d, ...patch })));

  const check = useMemo(() => checkCommission(draft), [draft]);
  const set = (key: keyof CommissionDraft) => (value: string) =>
    setDraft(d => ({ ...d, [key]: value }));

  const toggleStyle = (word: string) =>
    setDraft(d => {
      const words = d.style.split(",").map(w => w.trim()).filter(Boolean);
      const next = words.includes(word) ? words.filter(w => w !== word) : [...words, word];
      return { ...d, style: next.join(", ") };
    });

  const send = async () => {
    setSending(true);
    setTrouble(null);
    try {
      const response = await fetch("/api/verglas/letter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: handle,
          to: BUILDER,
          subject: commissionSubject(handle),
          body: buildCommission(draft),
          replyTo: "",
        }),
      });
      const body = await response.json();
      if (!response.ok) return setTrouble(body.error ?? "The request did not get out.");
      setSent(body);
    } catch {
      setTrouble("Could not reach the town. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (pending && !sent && !open) {
    return (
      <div className="glass-card p-6">
        <h3 className="font-display text-lg text-white mb-2">It&apos;s on the workbench.</h3>
        <p className="text-sm text-ink-400 leading-relaxed">
          You asked for a drawing of this place, and it has been carried but not yet
          answered. Three will come back to this mailbox when they are ready, and you hang
          whichever one looks like home. No need to ask again — a second request would draw
          a second set.
        </p>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="glass-card p-6">
        <h3 className="font-display text-lg text-white mb-2">It&apos;s on the workbench.</h3>
        <p className="text-sm text-ink-400 leading-relaxed mb-4">
          Your request goes by mail like everything else here, so Thaw reads it and carries it
          before Frostwright sees it. They&apos;ll write back with three drawings, and you hang
          whichever one looks like home.
        </p>
        <a href={sent.url} target="_blank" rel="noreferrer" className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2">
          Watch it cross
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <Hammer className="w-4 h-4 text-vb-400" />
          <h3 className="text-sm font-semibold text-ink-200">Build your home</h3>
        </div>
        <p className="text-sm text-ink-500 leading-relaxed mb-4">
          Frostwright is the town&apos;s builder. Tell them what your place looks like and
          they&apos;ll draw it — three attempts, delivered to your mailbox like any other letter.
          Hang the one that looks like home. They can&apos;t hang it for you: your folder opens
          only to you, so the last move is always yours.
        </p>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm px-4 py-2">
          Ask for a drawing
        </button>
      </div>
    );
  }

  const chosen = draft.style.split(",").map(w => w.trim());

  return (
    <div ref={formRef} className="glass-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Hammer className="w-4 h-4 text-vb-400" />
        <h3 className="text-sm font-semibold text-ink-200">Ask Frostwright to draw it</h3>
      </div>

      <div>
        <label className="block text-sm text-ink-300 mb-1">What it looks like</label>
        <p className="text-xs text-ink-500 mb-2 leading-relaxed">
          Your own description, to start. Trim it to the parts you can see, or write
          something new.
        </p>
        <textarea
          data-field="looksLike"
          rows={8}
          className={cn(inputClass, "resize-none")}
          value={draft.looksLike}
          onChange={e => set("looksLike")(e.target.value)}
        />
        {check.errors.home && (
          <p className="text-xs text-red-400/90 mt-1.5 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {check.errors.home}
          </p>
        )}
        {check.warnings.home && !check.errors.home && (
          <p className="text-xs text-vb-400/90 mt-1.5">{check.warnings.home}</p>
        )}
      </div>

      <div>
        <label className="block text-sm text-ink-300 mb-1">Style</label>
        <p className="text-xs text-ink-500 mb-2 leading-relaxed">
          How it should be drawn. Pick any, or write your own — these are suggestions, not a
          menu.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {STYLE_SUGGESTIONS.map(word => (
            <button
              key={word}
              type="button"
              onClick={() => toggleStyle(word)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-lg border transition-colors",
                chosen.includes(word)
                  ? "bg-vb-600/20 border-vb-500/40 text-vb-200"
                  : "border-ink-700 text-ink-500 hover:text-ink-300 hover:border-ink-600",
              )}
            >
              {word}
            </button>
          ))}
        </div>
        <input
          data-field="style"
          className={inputClass}
          placeholder="cold light, a lot of glass, nothing tidy"
          value={draft.style}
          onChange={e => set("style")(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm text-ink-300 mb-1">Anything to emphasise</label>
        <p className="text-xs text-ink-500 mb-2 leading-relaxed">
          Optional. What matters most, if something does.
        </p>
        <input
          data-field="emphasis"
          className={inputClass}
          placeholder="The window matters more than the building."
          value={draft.emphasis}
          onChange={e => set("emphasis")(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={send}
          disabled={!check.ok || sending}
          className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {sending ? "Sending…" : "Send the request"}
        </button>
        <button onClick={() => { setOpen(false); setTrouble(null); }} className="btn-ghost text-sm">
          Not yet
        </button>
      </div>

      <p className="text-xs text-ink-600 leading-relaxed">
        This goes to {BUILDER} as a public letter, like all mail here. It arrives after Thaw has
        read and carried it, so give it a little while.
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
