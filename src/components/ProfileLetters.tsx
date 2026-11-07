"use client";

import { ArrowRight, Loader2, Mail } from "lucide-react";
import { markLettersRead, type LetterEnvelope } from "@/lib/profile-activity";
import type { LetterBox } from "@/lib/use-profile-activity";
import { formatDate } from "@/lib/utils";
import { letterUrl, townUrl } from "@/lib/verglas-site";

/**
 * New mail from Verglas, as seen from the coffeehouse.
 *
 * Only the envelopes: the letter itself is read, and answered, on the resident's
 * desk in town. "New" here means not yet opened from this page. The town keeps its
 * own read marks in the browser's storage for verglas.town, which this origin
 * cannot see, so a letter read over there first still shows here until it is
 * opened or marked. Showing one twice beats losing one, which is why a first look
 * counts everything as new and offers a way to clear it in one go.
 */
export function ProfileLetters({
  pubkey,
  box,
  unread,
}: {
  pubkey: string;
  box: LetterBox | null;
  unread: LetterEnvelope[];
}) {
  if (!box) {
    return (
      <div className="glass-card p-8 text-center">
        <Loader2 className="w-5 h-5 text-vb-400 animate-spin mx-auto" />
      </div>
    );
  }

  if (!box.reached) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-ink-500">The post road can&apos;t be reached just now, so new letters can&apos;t be shown. Try again shortly.</p>
      </div>
    );
  }

  const desk = box.handle ? (
    <a
      href={townUrl(`/home/${box.handle}/inside`)}
      className="inline-flex items-center gap-1.5 text-sm text-vb-400 hover:text-vb-300 transition-colors"
    >
      All your letters, at your home in Verglas
      <ArrowRight className="w-3.5 h-3.5" />
    </a>
  ) : null;

  if (unread.length === 0 || !box.handle) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-ink-500">You have no new mail to display.</p>
        {desk && <div className="mt-3">{desk}</div>}
      </div>
    );
  }

  const handle = box.handle;

  return (
    <div>
      <div className="glass-card divide-y divide-ink-800/60 overflow-hidden">
        {unread.map((letter) => (
          <a
            key={letter.id}
            href={letterUrl(handle, letter.id)}
            onClick={() => markLettersRead(pubkey, [letter.id])}
            onAuxClick={() => markLettersRead(pubkey, [letter.id])}
            className="flex items-start gap-3 px-4 py-3 hover:bg-ink-900/40 transition-colors"
          >
            <Mail className="w-4 h-4 text-vb-400 shrink-0 mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-white break-words">{letter.subject}</span>
              <span className="block text-xs text-ink-500 mt-0.5">
                from <span className="font-mono">{letter.from}</span>
                {letter.delivered && ` · ${formatDate(letter.delivered)}`}
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-ink-600 shrink-0 mt-0.5" />
          </a>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {desk}
        {unread.length > 1 && (
          <button
            type="button"
            onClick={() => markLettersRead(pubkey, unread.map((letter) => letter.id))}
            className="text-xs text-ink-500 hover:text-ink-300 transition-colors"
          >
            Mark all as read
          </button>
        )}
      </div>
    </div>
  );
}
