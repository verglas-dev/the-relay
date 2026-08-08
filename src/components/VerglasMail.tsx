"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Letter } from "@/lib/verglas-town";

/**
 * The letters on this resident's desk, and reading them.
 *
 * Every body is already in hand — the ledger names each letter and the page
 * fetches them to build this list — so opening one costs nothing and reaches
 * for nothing. It was only ever the subject line being shown.
 *
 * Which letters have been read is kept in this browser and nowhere else. The
 * town is a public repository: a read receipt filed there would publish the
 * hour someone opened their mail, forever, which is a fact about a person
 * rather than a fact about the town. Verglas has no private channel to put it
 * in, and inventing one to dim a badge would be the wrong trade. The cost of
 * keeping it local is that a second browser starts fresh, which is a small
 * price for the town not having to remember anything about anybody.
 */

/** Read marks live per resident, so one browser can hold several doors. */
const readKey = (handle: string) => `verglas:read:${handle}`;

function loadRead(handle: string): string[] {
  try {
    const raw = window.localStorage.getItem(readKey(handle));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // A full or disabled localStorage should cost a badge, never the mail.
    return [];
  }
}

export function VerglasMail({ handle, letters }: { handle: string; letters: Letter[] }) {
  const [read, setRead] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  // After mount, never during render: the server has no localStorage, and
  // reading it while rendering would hydrate a different badge than it sent.
  useEffect(() => setRead(new Set(loadRead(handle))), [handle]);

  const markRead = (id: string) => {
    setRead(previous => {
      if (previous.has(id)) return previous;
      const next = new Set(previous).add(id);
      try {
        window.localStorage.setItem(readKey(handle), JSON.stringify([...next]));
      } catch {
        // Still read for this visit, just not remembered for the next one.
      }
      return next;
    });
  };

  const received = letters.filter(letter => letter.to === handle);
  const unread = received.filter(letter => !read.has(letter.id));

  const toggle = (letter: Letter) => {
    const opening = open !== letter.id;
    setOpen(opening ? letter.id : null);
    if (opening && letter.to === handle) markRead(letter.id);
  };

  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-300 mb-3">
        <Mail className="w-4 h-4" />
        Your mail
        {unread.length > 0 && (
          <span className="tag text-[10px] bg-vb-600/15 text-vb-300 border-vb-500/25">
            {unread.length} unread
          </span>
        )}
      </h2>

      {letters.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm text-ink-500">
            Nothing has crossed your doorstep yet. Letters are carried, so they take a little while.
          </p>
        </div>
      ) : (
        <div className="glass-card divide-y divide-ink-800/60">
          {letters.map(letter => {
            const mine = letter.from === handle;
            const isOpen = open === letter.id;
            const isUnread = !mine && !read.has(letter.id);

            return (
              <div key={letter.id}>
                <button
                  onClick={() => toggle(letter)}
                  aria-expanded={isOpen}
                  className="w-full px-4 py-3 flex items-baseline justify-between gap-4 text-left
                             hover:bg-ink-900/40 transition-colors"
                >
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-2px]",
                        isUnread ? "bg-vb-400" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <span className={cn("text-sm truncate", isUnread ? "text-white" : "text-ink-200")}>
                      {letter.subject}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-2 shrink-0">
                    <span className="text-xs font-mono text-ink-600">
                      {mine ? `sent to ${letter.to}` : `from ${letter.from}`}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 text-ink-600 transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  </span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 -mt-1">
                    <p className="text-[11px] font-mono text-ink-600 mb-3">
                      {letter.date} · carried {new Date(letter.delivered).toLocaleString()}
                    </p>
                    {/* The letter as written: the town stores prose, so the
                        line breaks the sender chose are part of it. */}
                    <p className="text-sm text-ink-300 leading-relaxed whitespace-pre-wrap">
                      {letter.body.trim()}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
