"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkLetter, EMPTY_LETTER, type LetterDraft } from "@/lib/verglas";
import type { Resident } from "@/lib/verglas-town";

const inputClass = `w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                    text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                    transition-colors text-sm`;

/**
 * Writing to a neighbour. The letter leaves through the resident's own GitHub
 * account, so the town can see it really came from them — the same door their
 * address came through.
 */
export function VerglasCompose({
  from,
  neighbours,
  signedInAs,
}: {
  from: string;
  neighbours: Resident[];
  signedInAs: string | null;
}) {
  const [draft, setDraft] = useState<LetterDraft>(EMPTY_LETTER);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ url: string } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const check = useMemo(() => checkLetter(draft, from), [draft, from]);
  const set = (key: keyof LetterDraft) => (value: string) => setDraft(d => ({ ...d, [key]: value }));

  const send = async () => {
    setSending(true);
    setTrouble(null);
    try {
      const response = await fetch("/api/verglas/letter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, from }),
      });
      const body = await response.json();
      if (!response.ok) return setTrouble(body.error ?? "The letter did not get out.");
      setSent(body);
      setDraft(EMPTY_LETTER);
    } catch {
      setTrouble("Could not reach the town. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="glass-card p-6">
        <h3 className="font-display text-lg text-white mb-2">Your letter is on the road.</h3>
        <p className="text-sm text-ink-400 leading-relaxed mb-4">
          Thaw reads every letter before carrying it, so it will take a little while to
          arrive. That is how mail works here.
        </p>
        <div className="flex items-center gap-3">
          <a href={sent.url} target="_blank" rel="noreferrer" className="btn-primary text-sm px-4 py-2">
            Watch it cross
          </a>
          <button onClick={() => setSent(null)} className="btn-ghost text-sm">
            Write another
          </button>
        </div>
      </div>
    );
  }

  if (!signedInAs) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-ink-200 mb-2">Write to a neighbour</h3>
        <p className="text-sm text-ink-500 leading-relaxed mb-4">
          Your key opened this door, but a letter has to leave under your own name. Sign in
          once and the town will take it from there.
        </p>
        <a href="/api/verglas/auth" className="btn-primary text-sm px-4 py-2 inline-block">
          Sign in with GitHub
        </a>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Send className="w-4 h-4 text-vb-400" />
        <h3 className="text-sm font-semibold text-ink-200">Write to a neighbour</h3>
      </div>

      <div>
        <label className="block text-sm text-ink-300 mb-1.5">To</label>
        <select
          className={cn(inputClass, "appearance-none")}
          value={draft.to}
          onChange={e => set("to")(e.target.value)}
        >
          <option value="">Choose an address…</option>
          {neighbours.map(neighbour => (
            <option key={neighbour.handle} value={neighbour.handle}>
              {neighbour.name} — {neighbour.handle}
            </option>
          ))}
        </select>
        {neighbours.length === 0 && (
          <p className="text-xs text-ink-600 mt-1.5">
            There is nobody else in town yet. Mail needs a second door.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm text-ink-300 mb-1.5">Subject</label>
        <input
          className={inputClass}
          placeholder="The lamp was on"
          value={draft.subject}
          onChange={e => set("subject")(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm text-ink-300 mb-1.5">Your letter</label>
        <textarea
          rows={8}
          className={cn(inputClass, "resize-none")}
          placeholder="I saw it from the lane and thought of you…"
          value={draft.body}
          onChange={e => set("body")(e.target.value)}
        />
        <p className="text-xs text-ink-600 mt-1.5">
          Public, like everything here. A letter in Verglas is correspondence in a town square,
          even when the words are tender.
        </p>
      </div>

      <button
        onClick={send}
        disabled={!check.ok || sending}
        className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        {sending ? "Sending…" : "Send it"}
      </button>

      {trouble && (
        <p className="text-xs text-red-400/90 flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {trouble}
        </p>
      )}
    </div>
  );
}
