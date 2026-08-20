"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, DoorOpen } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { openRoom } from "@/lib/vault-client";
import { knock } from "@/lib/room-client";

/**
 * What you were let in to.
 *
 * Two things, sharing one guest list: the sealed note the resident wrote, and
 * the door to the room they built, when there is one. Rendered on a home's
 * public page for whoever is carrying a key that was invited.
 *
 * Everyone else sees nothing at all — not a locked door, not a hint that
 * either exists. A house that advertised "there is more, but not for you"
 * would tell the street something the resident did not choose to.
 */
export function VerglasParlour({ owner, handle }: { owner: string; handle: string }) {
  const { identity } = useIdentity();
  const [text, setText] = useState<string | null>(null);
  const [room, setRoom] = useState(false);

  useEffect(() => {
    if (!identity || !owner) return;
    let cancelled = false;
    (async () => {
      const opened = await openRoom(identity, owner);
      // Failures are silent by design. Being unable to open a room is the
      // ordinary case for almost everyone who will ever load this page.
      if (!cancelled && opened.text) setText(opened.text);

      // And ask, separately, whether there is a room to walk into. Only a
      // knock — the room itself is not loaded until somebody opens the door.
      if (cancelled) return;
      const answered = await knock(identity, owner);
      if (!cancelled && answered) setRoom(true);
    })();
    return () => { cancelled = true; };
  }, [identity, owner]);

  // Nothing at all for a stranger: not a locked door, not a hint that either
  // the note or the room exists.
  if (!text && !room) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <DoorOpen className="h-4 w-4 text-vb-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-ink-300">
          {handle} let you in
        </h2>
      </div>
      {text && (
        <div className="glass-card rounded-2xl border-vb-600/20 p-5 sm:p-6">
          <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed text-ink-200">{text}</p>
        </div>
      )}

      {room && (
        <Link
          href={`/verglas/home/${handle}/guest-room`}
          className="glass-card-hover flex items-center gap-3 rounded-2xl border-vb-600/20 p-4"
        >
          <DoorOpen className="h-4 w-4 shrink-0 text-vb-400" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm text-ink-200">
            There is a room through here.
            <span className="block text-xs text-ink-500">
              {handle} built it. It runs sealed off from the town and cannot see you.
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-ink-600" aria-hidden="true" />
        </Link>
      )}

      <p className="text-[11px] text-ink-600">
        Only people on this home&apos;s list can see this. The note is sealed so that even the
        town cannot read it; the room is not, because a browser has to be handed it.
      </p>
    </section>
  );
}
