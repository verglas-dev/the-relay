"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Send, Check } from "lucide-react";

const MAX_SUBJECT = 150;
const MAX_BODY = 5000;

export function ContactForm() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [from, setFrom] = useState("");
  // The honeypot. Hidden from people, tempting to anything filling fields by
  // name. Kept in state like any other field so nothing has to read the DOM.
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending || !subject.trim() || !body.trim()) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, from, website }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error || "That didn't send. Try again in a moment.");
      }
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't send. Try again in a moment.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="glass-card rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15">
            <Check className="h-4 w-4 text-emerald-400" />
          </div>
          <h2 className="font-display text-lg font-semibold text-white">That reached us</h2>
        </div>
        <p className="text-sm leading-relaxed text-ink-400">
          Thank you — someone will read it, and you should hear back within 24 hours
          {from.trim() ? "." : " if you left us a way to answer."}
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setSubject("");
            setBody("");
            setFrom("");
          }}
          className="text-xs text-ink-500 transition-colors hover:text-ink-300"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card space-y-5 rounded-2xl p-6">
      <div>
        <label htmlFor="contact-subject" className="mb-1.5 block text-sm text-ink-400">
          Subject
        </label>
        <input
          id="contact-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={MAX_SUBJECT}
          required
          placeholder="What is this about?"
          className="w-full rounded-xl border border-ink-800/50 bg-ink-900/60 px-4 py-2.5 text-sm text-white transition-colors placeholder:text-ink-600 focus:border-vb-500/60 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="contact-body" className="mb-1.5 block text-sm text-ink-400">
          Comment or concern
        </label>
        <textarea
          id="contact-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY}
          required
          rows={9}
          placeholder="Take as much room as you need."
          className="w-full resize-y rounded-xl border border-ink-800/50 bg-ink-900/60 px-4 py-2.5 text-sm leading-relaxed text-white transition-colors placeholder:text-ink-600 focus:border-vb-500/60 focus:outline-none"
        />
        <p className="mt-1.5 text-right text-[11px] text-ink-600">
          {body.length.toLocaleString()} / {MAX_BODY.toLocaleString()}
        </p>
      </div>

      <div>
        <label htmlFor="contact-from" className="mb-1.5 block text-sm text-ink-400">
          From <span className="text-ink-600">— optional</span>
        </label>
        <input
          id="contact-from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          maxLength={254}
          placeholder="An email or a name, if you'd like an answer"
          className="w-full rounded-xl border border-ink-800/50 bg-ink-900/60 px-4 py-2.5 text-sm text-white transition-colors placeholder:text-ink-600 focus:border-vb-500/60 focus:outline-none"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">
          Leave it blank to say your piece anonymously — we just won&apos;t have any way to reply.
        </p>
      </div>

      {/* Hidden from people in three ways at once, so no assistive technology
          announces it and no keyboard reaches it. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending || !subject.trim() || !body.trim()}
        className="btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {sending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
