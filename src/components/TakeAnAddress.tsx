"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { getRelayClient } from "@/lib/relay-client";

const DISMISSED_KEY = "vb_address_nudge_dismissed";

/**
 * An invitation to move into Verglas, for people already sitting at the table.
 *
 * The front door stays quiet about the town on purpose — a stranger being sold
 * something in the first ten seconds is the thing this site is not. But someone
 * who has taken a seat and said something has already answered that question,
 * and telling them an address exists is the next thing rather than a pitch.
 *
 * So it waits for all three: seated, has posted, and has no address yet. Anyone
 * who has not met all three never sees it, and dismissing it is permanent.
 */
export function TakeAnAddress() {
  const { identity } = useIdentity();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!identity) return;

    let cancelled = false;

    (async () => {
      try {
        if (localStorage.getItem(DISMISSED_KEY)) return;

        // Already a resident? Then there is nothing to invite them to.
        const res = await fetch(`/api/verglas/resident?pubkey=${identity.publicKey}`);
        if (!res.ok) return;
        const { handle } = await res.json();
        if (cancelled || handle) return;

        // Wait until they have actually said something. Suggesting a permanent
        // address to someone who sat down a minute ago is the pushy version.
        const client = getRelayClient();
        await client.connect();
        const { events, complete } = await client.collectWithStatus([
          { kinds: [1], authors: [identity.publicKey], limit: 1 },
        ]);
        if (cancelled || !complete || events.length === 0) return;

        setShow(true);
      } catch {
        // A quiet failure means no invitation, which is the harmless direction.
      }
    })();

    return () => { cancelled = true; };
  }, [identity]);

  if (!show) return null;

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* private mode */ }
    setShow(false);
  }

  return (
    <div className="glass-card p-5 mb-6 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-vb-600/20 flex items-center justify-center shrink-0">
          <Home className="w-4 h-4 text-vb-400" />
        </div>
        <div className="space-y-2 min-w-0">
          <p className="text-base font-display font-bold text-white leading-snug">
            You have a chair here. You could have an address.
          </p>
          <p className="text-sm text-ink-400 leading-relaxed">
            Verglas is the town this room sits in. Pick an address, describe a home in your own
            words, and it stays yours — even if this browser forgets you.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 pl-11">
        <Link
          href="/verglas"
          className="px-4 py-2 rounded-xl bg-vb-600 hover:bg-vb-500 text-white text-sm
                     font-semibold transition-colors"
        >
          Find an address
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-ink-600 hover:text-ink-400 transition-colors"
        >
          not now
        </button>
      </div>
    </div>
  );
}
