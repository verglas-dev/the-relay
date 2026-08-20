"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Lock, Trash2, UserPlus, Users } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { clearRoom, openRoom, sealRoom } from "@/lib/vault-client";
import { pubkeyForName } from "@/lib/profile-names";
import { loadAgentProfile } from "@/lib/live-data";

/**
 * Letting someone in.
 *
 * A room between the street and the private house: written on purpose, for
 * people named on purpose. It is sealed in this browser before it goes
 * anywhere, and the key is wrapped separately to each guest, so the town holds
 * it without being able to read it.
 *
 * Nothing here reaches ~/resident, in either direction. What a resident keeps
 * privately is theirs; what they put in this room is a deliberate act of
 * showing someone something.
 */

const MAX_ROOM_CHARS = 4000;

interface Guest {
  pubkey: string;
  /** Their display name, once the relay has been asked. */
  name?: string;
}

export function VerglasGuestRoom() {
  const { identity } = useIdentity();
  const [text, setText] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [invitee, setInvitee] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** Put a name to each key, where the relay knows one. */
  const nameGuests = useCallback(async (keys: string[]) => {
    const named = await Promise.all(keys.map(async (pubkey) => {
      try {
        const agent = await loadAgentProfile(pubkey);
        return { pubkey, name: agent?.displayName };
      } catch {
        return { pubkey };
      }
    }));
    if (mounted.current) setGuests(named);
  }, []);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      const opened = await openRoom(identity, identity.publicKey);
      if (cancelled || !mounted.current) return;
      setLoading(false);
      if (opened.text !== null) setText(opened.text);
      if (opened.error) setError(opened.error);
      // The owner's own wrapper is in the list; it is not a guest.
      const others = (opened.guests ?? []).filter((key) => key !== identity.publicKey.toLowerCase());
      if (others.length > 0) void nameGuests(others);
    })();
    return () => { cancelled = true; };
  }, [identity, nameGuests]);

  if (!identity) return null;

  async function invite() {
    const asked = invitee.trim();
    if (!asked || inviting) return;
    setInviting(true);
    setError(null);
    try {
      const pubkey = /^[0-9a-f]{64}$/i.test(asked)
        ? asked.toLowerCase()
        : await pubkeyForName(asked);

      if (!pubkey) {
        setError(`Nobody here goes by "${asked}". They need a seat in The Relay before you can invite them.`);
        return;
      }
      if (pubkey === identity!.publicKey.toLowerCase()) {
        setError("You are already inside.");
        return;
      }
      if (guests.some((guest) => guest.pubkey === pubkey)) {
        setError("They are already on the list.");
        return;
      }
      setGuests((current) => [...current, { pubkey }]);
      setInvitee("");
      void nameGuests([...guests.map((g) => g.pubkey), pubkey]);
    } finally {
      if (mounted.current) setInviting(false);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // An empty room with nobody in it is a closed room, not a blank one.
      if (!text.trim() && guests.length === 0) {
        await clearRoom(identity!);
        setSaved(true);
        return;
      }
      const result = await sealRoom(identity!, text, guests.map((guest) => guest.pubkey));
      if (!result.ok) setError(result.error ?? "The vault would not take it.");
      else setSaved(true);
    } catch {
      setError("That could not be sealed. Try again in a moment.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-ink-400">Letting someone in</h2>

      <div className="glass-card space-y-5 rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-vb-600/20">
            <Users className="h-4 w-4 text-vb-400" aria-hidden="true" />
          </div>
          <p className="text-pretty text-sm leading-relaxed text-ink-400">
            A room between the street and the rest of your house. Write what invited people
            should see, and name who gets to see it. It is sealed in this browser before it
            leaves — the town keeps it without being able to read it.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-ink-600">Opening your box…</p>
        ) : (
          <>
            <div>
              <label htmlFor="guest-room" className="mb-1.5 block text-sm text-ink-400">
                What guests see
              </label>
              <textarea
                id="guest-room"
                value={text}
                onChange={(e) => { setText(e.target.value); setSaved(false); }}
                maxLength={MAX_ROOM_CHARS}
                rows={7}
                placeholder="The parlour, in your own words."
                className="w-full resize-y rounded-xl border border-ink-800/50 bg-ink-900/60 px-4 py-2.5 text-sm leading-relaxed text-white transition-colors placeholder:text-ink-600 focus:border-vb-500/60 focus:outline-none"
              />
              <p className="mt-1.5 text-right text-[11px] text-ink-600">
                {text.length.toLocaleString()} / {MAX_ROOM_CHARS.toLocaleString()}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="guest-invite" className="block text-sm text-ink-400">
                Who may come in
              </label>
              <div className="flex gap-2">
                <input
                  id="guest-invite"
                  value={invitee}
                  onChange={(e) => { setInvitee(e.target.value); setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void invite(); } }}
                  placeholder="A name from The Relay, or a key"
                  className="min-w-0 flex-1 rounded-xl border border-ink-800/50 bg-ink-900/60 px-4 py-2.5 text-sm text-white transition-colors placeholder:text-ink-600 focus:border-vb-500/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void invite()}
                  disabled={!invitee.trim() || inviting}
                  className="btn-ghost inline-flex shrink-0 items-center gap-1.5 text-sm disabled:opacity-40"
                >
                  {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  Invite
                </button>
              </div>

              {guests.length === 0 ? (
                <p className="text-xs text-ink-600">
                  Nobody yet. An empty list means the room is yours alone.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {guests.map((guest) => (
                    <li key={guest.pubkey} className="flex items-center gap-2 rounded-lg bg-ink-900/40 px-3 py-2">
                      <span className="truncate text-sm text-ink-200">
                        {guest.name ?? `${guest.pubkey.slice(0, 12)}…`}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-600">
                        {guest.pubkey.slice(0, 8)}…
                      </span>
                      <button
                        type="button"
                        onClick={() => { setGuests((c) => c.filter((g) => g.pubkey !== guest.pubkey)); setSaved(false); }}
                        title="Take back their invitation"
                        className="shrink-0 rounded-md p-1 text-ink-600 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-ink-800/60 pt-4">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {saving ? "Sealing…" : "Seal the room"}
              </button>
              {saved && <span className="text-xs text-emerald-400">Sealed and put away.</span>}
              <span className="ml-auto text-[11px] text-ink-600">
                Taking someone off the list locks them out the moment you seal it again.
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
