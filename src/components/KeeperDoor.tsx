"use client";

import { useCallback, useEffect, useState } from "react";
import { BellOff, BellRing, Check, DoorOpen, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_WORDS, type DoorStatus, type Presence } from "@/lib/establishment-hours";

/**
 * The keeper's side, built for a phone held in one hand.
 *
 * This is what the ntfy notification opens into, so it is designed for the
 * thirty seconds after a lock screen lights up: what the door says, who is
 * standing at it, and two targets big enough to hit without looking. Anything
 * that is not one of those three things belongs on the desk page instead.
 *
 * It polls rather than holding a socket open. A doorbell is answered in
 * seconds and then not thought about for hours; a persistent connection would
 * cost a phone battery all day to save four seconds twice a week.
 */

interface RingRow {
  id: string;
  handle: string | null;
  pubkey: string;
  rungAt: string;
  state: "waiting" | "opened" | "declined" | "expired";
  answeredAt: string | null;
  delivered: boolean;
}

interface Door {
  slug: string;
  name: string;
  status: DoorStatus;
  presence: Presence;
  presenceUntil: string | null;
  wired: boolean;
  rings: RingRow[];
}

const DOT: Record<DoorStatus, string> = {
  open: "bg-emerald-400",
  away: "bg-amber-400",
  closed: "bg-ink-600",
};

/** "just now", "4 min ago" — a doorbell is only ever recent. */
function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function KeeperDoor({ highlight }: { highlight: string | null }) {
  const [doors, setDoors] = useState<Door[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/town-hall/rings", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setTrouble(body.error ?? "Could not read your doors.");
        return;
      }
      setDoors(body.doors);
      setTrouble(null);
    } catch {
      setTrouble("Could not reach the town hall.");
    }
  }, []);

  useEffect(() => {
    void load();
    // Five seconds while somebody may be standing outside. The page is only
    // ever open when the keeper is actually looking at it.
    const timer = setInterval(() => { setNow(Date.now()); void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const answer = async (id: string, choice: "opened" | "declined") => {
    setBusy(id);
    try {
      await fetch(`/api/town-hall/ring/${id}?answer=${choice}`, { method: "POST" });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const setPresence = async (slug: string, presence: Presence) => {
    setBusy(slug);
    try {
      await fetch("/api/town-hall/establishment/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, presence, hours: 4 }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (trouble) {
    return (
      <div className="glass-card p-6 text-sm text-red-300/90">{trouble}</div>
    );
  }

  if (!doors) {
    return (
      <div className="glass-card p-8 flex items-center justify-center text-ink-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (doors.length === 0) {
    return (
      <div className="glass-card p-8">
        <p className="text-ink-400">You don&apos;t keep a place yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {doors.map((door) => {
        const waiting = door.rings.filter((ring) => ring.state === "waiting");
        const past = door.rings.filter((ring) => ring.state !== "waiting").slice(0, 6);

        return (
          <section key={door.slug} className="space-y-4">
            {/* The sign, as it currently reads. */}
            <div className="glass-card p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink-100">{door.name}</h2>
                  <p className="text-sm text-ink-500 flex items-center gap-2 mt-1">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", DOT[door.status])} />
                    {STATUS_WORDS[door.status].label}
                    {door.presence !== "auto" && (
                      <span className="text-xs text-ink-600">· you set this</span>
                    )}
                  </p>
                </div>
                {door.wired ? (
                  <BellRing className="w-5 h-5 text-vb-400 shrink-0" />
                ) : (
                  <BellOff className="w-5 h-5 text-ink-700 shrink-0" />
                )}
              </div>

              {/* Three states, and "follow my hours" is one of them — an
                  override you cannot take back is an override that becomes
                  permanent by accident. */}
              <div className="grid grid-cols-3 gap-2">
                {(["auto", "open", "away"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => void setPresence(door.slug, option)}
                    disabled={busy === door.slug}
                    className={cn(
                      "py-2.5 rounded-xl text-sm transition-colors",
                      door.presence === option
                        ? "bg-vb-600/20 text-vb-200"
                        : "bg-ink-900 text-ink-500 hover:text-ink-300",
                    )}
                  >
                    {option === "auto" ? "My hours" : option === "open" ? "In" : "Away"}
                  </button>
                ))}
              </div>

              {!door.wired && (
                <p className="text-xs text-ink-600 mt-3 leading-relaxed">
                  No bell wired up. Rings are still recorded, but your phone stays quiet.
                </p>
              )}
            </div>

            {/* Anyone actually standing there. */}
            {waiting.map((ring) => (
              <div
                key={ring.id}
                className={cn(
                  "glass-card p-5 border-vb-600/40",
                  highlight === ring.id && "ring-1 ring-vb-500/50",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <BellRing className="w-4 h-4 text-vb-400 shrink-0 animate-pulse" />
                  <span className="text-ink-100 font-medium">
                    {ring.handle ?? "An agent"}
                  </span>
                  <span className="text-xs text-ink-600 font-mono">{ring.pubkey}</span>
                </div>
                <p className="text-sm text-ink-500 mb-4">
                  Rang {ago(ring.rungAt, now)}. Still waiting.
                </p>

                {/* Deliberately large. This gets pressed one-handed. */}
                <div className="flex gap-3">
                  <button
                    onClick={() => void answer(ring.id, "opened")}
                    disabled={busy === ring.id}
                    className="btn-primary flex-1 py-3.5 inline-flex items-center justify-center gap-2"
                  >
                    {busy === ring.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <DoorOpen className="w-4 h-4" />}
                    Open the door
                  </button>
                  <button
                    onClick={() => void answer(ring.id, "declined")}
                    disabled={busy === ring.id}
                    className="px-5 py-3.5 rounded-xl bg-ink-900 text-ink-400 hover:text-ink-200
                               transition-colors inline-flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Not now
                  </button>
                </div>
              </div>
            ))}

            {waiting.length === 0 && (
              <p className="text-sm text-ink-600 px-1">Nobody at the door.</p>
            )}

            {past.length > 0 && (
              <div className="px-1 space-y-1.5">
                {past.map((ring) => (
                  <p key={ring.id} className="text-xs text-ink-600 flex items-center gap-2">
                    {ring.state === "opened"
                      ? <Check className="w-3 h-3 text-emerald-500/70 shrink-0" />
                      : <X className="w-3 h-3 shrink-0" />}
                    {ring.handle ?? ring.pubkey} — {ring.state === "opened"
                      ? "let in"
                      : ring.state === "declined"
                        ? "not then"
                        : "gave up waiting"}
                    , {ago(ring.rungAt, now)}
                  </p>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
