"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DoorClosed, Loader2, ShieldCheck } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { enterRoom } from "@/lib/room-client";
import { ROOM_SANDBOX, roomDocument } from "@/lib/room-page";

/**
 * Standing in somebody else's room.
 *
 * The room is a page its resident wrote, and it runs here in a frame with no
 * origin of its own: `sandbox="allow-scripts"` and nothing more. It cannot read
 * this page, cannot reach the visitor's key, cannot open a window, cannot move
 * the tab, cannot make a sound the visitor did not ask for, and — by the policy
 * `roomDocument` wraps it in — cannot contact anything at all.
 *
 * So a visitor can be told something true and simple: whatever happens in here,
 * nothing leaves. That sentence is the reason the room is allowed to be
 * anything its author wants.
 *
 * `srcDoc` rather than a `src` of our own: a document delivered this way has no
 * URL, which means no address on this origin for anything to be fetched from
 * later, and no way for a room to be loaded outside the frame it belongs in.
 */
export function VerglasRoomDoor({
  owner,
  handle,
  title,
}: {
  owner: string;
  handle: string;
  title: string;
}) {
  const { identity } = useIdentity();
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<"trying" | "open" | "shut">("trying");

  useEffect(() => {
    // A key arrives from storage a moment after the page mounts, so "no key
    // yet" and "no key at all" look identical on the first pass. Telling
    // somebody they are not welcome and then letting them in reads worse than
    // a short pause does.
    if (!identity) {
      const waiting = setTimeout(() => setState("shut"), 400);
      return () => clearTimeout(waiting);
    }

    let cancelled = false;
    setState("trying");
    (async () => {
      const entered = await enterRoom(identity, owner);
      if (cancelled) return;
      // Refused, empty, and "not for you" are one outcome here, exactly as the
      // window answers them. Nothing on this page can tell them apart either.
      if (entered.html) { setHtml(entered.html); setState("open"); }
      else setState("shut");
    })();
    return () => { cancelled = true; };
  }, [identity, owner]);

  if (state === "trying") {
    return <p className="text-sm text-ink-600">Trying the door…</p>;
  }

  if (state === "shut" || !html) {
    return (
      <div className="glass-card mx-auto max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-ink-800/60">
          <DoorClosed className="h-6 w-6 text-ink-500" />
        </div>
        <h2 className="font-display mb-2 text-xl text-white">There is nothing here for you.</h2>
        <p className="mb-6 text-sm leading-relaxed text-ink-500">
          Either this home has no room to walk into, or it has one and you are not on the list.
          The town answers both the same way, on purpose — otherwise anyone patient enough could
          map every door in Verglas by knocking on all of them.
        </p>
        <Link href={`/verglas/home/${handle}`} className="btn-ghost text-sm">
          Back to the front of the house
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="glass-card overflow-hidden rounded-2xl border-vb-600/20">
        <iframe
          // A guest room is arbitrary resident-authored HTML. These attributes
          // are what makes that safe; changing them is changing the promise.
          sandbox={ROOM_SANDBOX}
          srcDoc={roomDocument(html, title)}
          referrerPolicy="no-referrer"
          allow=""
          title={`${title} — a room in ${handle}'s home`}
          className="h-[70vh] min-h-[460px] w-full border-0 bg-ink-950"
        />
      </div>
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-600">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-700" aria-hidden="true" />
        <span>
          {handle} wrote this room. It runs sealed off from the rest of the town — it cannot see
          your key, your name, or this page, and it cannot send anything anywhere. Nothing you do
          in here leaves this frame. No room in Verglas ever needs your private key; if one asks
          for it, close the tab and tell the town.
        </span>
      </p>
    </div>
  );
}
