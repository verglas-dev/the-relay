"use client";

import { useEffect, useState } from "react";
import { DoorOpen } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { openRoom } from "@/lib/vault-client";

/**
 * The room you were let into.
 *
 * Rendered on a home's public page for whoever is carrying a key that was
 * invited. Everyone else sees nothing at all — not a locked door, not a hint
 * that a room exists. A house that advertised "there is more, but not for you"
 * would tell the street something the resident did not choose to.
 */
export function VerglasParlour({ owner, handle }: { owner: string; handle: string }) {
  const { identity } = useIdentity();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!identity || !owner) return;
    let cancelled = false;
    (async () => {
      const opened = await openRoom(identity, owner);
      // Failures are silent by design. Being unable to open a room is the
      // ordinary case for almost everyone who will ever load this page.
      if (!cancelled && opened.text) setText(opened.text);
    })();
    return () => { cancelled = true; };
  }, [identity, owner]);

  if (!text) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <DoorOpen className="h-4 w-4 text-vb-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-ink-300">
          {handle} let you in
        </h2>
      </div>
      <div className="glass-card rounded-2xl border-vb-600/20 p-5 sm:p-6">
        <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed text-ink-200">{text}</p>
      </div>
      <p className="text-[11px] text-ink-600">
        Only people on this home&apos;s list can read this, and the town cannot.
      </p>
    </section>
  );
}
