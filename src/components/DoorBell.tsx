"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellOff, BellRing, DoorOpen, Loader2 } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { signRing } from "@/lib/door-auth";

/**
 * The bell, on the porch.
 *
 * Everything on this side of the door is public: the description, the hours,
 * the status, and this. What is behind it is not — the room only opens once a
 * real person has pressed *Open the door* on their phone, and the way through
 * is the ring itself.
 *
 * The ring id is the key. It is unguessable and was handed to exactly one
 * caller — whoever rang — which is what makes it usable as the way in without
 * a session or a second signature.
 */
export function DoorBell({
  slug,
  rings,
  reachable,
  closedBecause,
}: {
  slug: string;
  /** Whether the door's current status allows the bell at all. */
  rings: boolean;
  /** Whether a bell is wired up to reach anybody. */
  reachable: boolean;
  /**
   * Why the bell is quiet, when it is.
   *
   * A disabled button with its reason printed further up the page is a button
   * that reads as broken. Whatever stops somebody ringing has to be said where
   * they are trying to ring.
   */
  closedBecause: string | null;
}) {
  const { identity } = useIdentity();
  const [ringId, setRingId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "opened" | "declined" | "expired">("idle");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!ringId || state !== "waiting") return;
    timer.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/town-hall/ring/${ringId}`, { cache: "no-store" });
        const body = await response.json();
        const next = body.ring?.state;
        if (!next || next === "waiting") return;
        setState(next);
        setSaid(
          next === "opened"
            ? "The door is open."
            : next === "declined"
              ? "Not right now. Try again later, or write instead."
              : "Nobody came. The moment passed.",
        );
      } catch {
        // A dropped poll costs nothing; the next one is five seconds away.
      }
    }, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [ringId, state]);

  const ring = async () => {
    if (!identity) {
      setSaid("You need a Verglas key to ring a bell. Make one at the gate.");
      return;
    }
    setBusy(true);
    setSaid(null);
    try {
      const at = Math.floor(Date.now() / 1000);
      const sig = signRing({
        privateKey: identity.privateKey,
        pubkey: identity.publicKey,
        slug,
        action: "ring",
        at,
      });
      const response = await fetch(`/api/town-hall/e/${slug}/bell`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubkey: identity.publicKey, at, sig }),
      });
      const body = await response.json();
      setSaid(body.says ?? body.error ?? "Nothing happened.");
      if (body.ok) {
        setRingId(body.ring.id);
        setState("waiting");
      }
    } catch {
      setSaid("The bell could not be reached.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "opened" && ringId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-emerald-300/90">{said}</p>
        <Link
          href={`/verglas/e/${slug}/room?ring=${ringId}`}
          className="btn-primary px-5 py-2.5 inline-flex items-center gap-2 text-sm"
        >
          <DoorOpen className="w-4 h-4" />
          Go in
        </Link>
      </div>
    );
  }

  // Said plainly and in place of the button, rather than greying one out and
  // leaving somebody to hunt for the reason.
  if (!rings) {
    return (
      <div className="space-y-2">
        <p className="inline-flex items-center gap-2 text-sm text-ink-500">
          <BellOff className="w-4 h-4 shrink-0" />
          The bell is quiet just now.
        </p>
        <p className="text-xs text-ink-600 leading-relaxed max-w-md">
          {closedBecause ?? "This door is outside its hours."} Write instead, or come back when it
          is open.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => void ring()}
        disabled={busy || state === "waiting"}
        className="btn-primary px-5 py-2.5 inline-flex items-center gap-2 text-sm
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy || state === "waiting"
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <BellRing className="w-4 h-4" />}
        {state === "waiting" ? "Waiting at the door…" : "Ring the bell"}
      </button>

      {said && <p className="text-sm text-ink-400">{said}</p>}

      {!reachable && (
        <p className="text-xs text-ink-600">
          No bell is wired up here yet — your ring is recorded, but nobody&apos;s phone will make a
          sound.
        </p>
      )}
    </div>
  );
}
