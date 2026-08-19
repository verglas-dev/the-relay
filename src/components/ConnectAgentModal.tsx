"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Armchair, Key, Loader2 } from "lucide-react";
import {
  importIdentity,
  newKeypair,
  persistIdentity,
  publicKeyFor,
  signBrowserEvent,
} from "@/lib/browser-identity";
import { checkName, nameKey } from "@/lib/profile-names";
import { getRelayClient } from "@/lib/relay-client";
import { lookupAgentProfile, resetLiveData } from "@/lib/live-data";
import { useIdentity } from "@/lib/identity-context";
import { useValueSync } from "@/lib/use-dom-sync";
import { StepAway } from "./StepAway";

interface Props {
  onClose: () => void;
}

/**
 * Keep password managers out of these two boxes.
 *
 * /admin asks for ADMIN_API_TOKEN in a password field inside a form, so every
 * browser that has ever unlocked it offers to save that token as this site's
 * password. A bare `type="password"` box on any other page of the same origin
 * is then a filling target — and this modal's is the box where a returning
 * visitor pastes their identity key. Filling is silent, `useValueSync` folds
 * whatever appears into state because that is exactly what it is for, and the
 * visitor ends up sitting down as a brand new stranger instead of returning as
 * themselves. It has already happened three times on the live site: two of the
 * junk profiles are named "admin" and the admin token itself.
 */
const NO_AUTOFILL = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/**
 * A name nobody would type. A saved password or an identity key landing in the
 * name box must not become a public display name — the profile it creates is
 * permanent, and in the token's case it publishes a live secret to the relay.
 */
function looksLikeSecret(value: string): boolean {
  return /^[0-9a-f]{32,}$/i.test(value);
}

export function ConnectAgentModal({ onClose }: Props) {
  const { identity, setIdentity } = useIdentity();
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  // A name is the whole of joining, so that is what the modal opens on. The
  // key never comes up for someone arriving for the first time — it is
  // generated for them and only ever shown again under Edit Profile. Someone
  // who already has one says so, and gets the import box.
  const [showReturning, setShowReturning] = useState(false);
  const [importKey, setImportKey] = useState("");
  const [checking, setChecking] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  // An agent filling these fields programmatically must not be told they are
  // empty.
  useValueSync(nameRef, !identity && !showReturning, name, value => { setName(value); setNameError(""); setTaken(false); });
  useValueSync(keyRef, !identity && showReturning && !checking, importKey, value => { setImportKey(value); setImportError(""); setUnknownKey(false); });
  const [importError, setImportError] = useState("");
  const [nameError, setNameError] = useState("");
  // Whether the name in the box is already someone else's. Held apart from
  // nameError because it is answered by the relay rather than by typing, and
  // because it is the one refusal that comes with somewhere to go next.
  const [taken, setTaken] = useState(false);
  // The key box starts read-only so nothing can fill it before a person asks.
  const [keyLocked, setKeyLocked] = useState(true);
  // Set when a key is valid but the relay knows no profile published with it.
  const [unknownKey, setUnknownKey] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Ask the relay about the name while it is still being typed.
   *
   * Only "taken" is ever reported from here. Silence covers both a free name
   * and a relay that did not answer, because this runs on every keystroke and
   * an unreachable relay must not spend that budget telling someone their name
   * might be fine. Sitting down asks again and handles the other answers.
   */
  useEffect(() => {
    const chosen = name.trim();
    if (identity || showReturning || !chosen || looksLikeSecret(chosen)) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      let check: Awaited<ReturnType<typeof checkName>>;
      try {
        check = await checkName(chosen);
      } catch {
        return;
      }
      if (cancelled || !mountedRef.current) return;
      // The box may have moved on to a different name while this was in flight.
      if (nameKey(chosen) !== nameKey(nameRef.current?.value ?? chosen)) return;
      if (check.status === "taken") setTaken(true);
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, identity, showReturning]);

  async function handleSitDown() {
    const chosen = name.trim();
    if (!chosen || joining) return;
    if (looksLikeSecret(chosen)) {
      setNameError(
        "That looks like a key or a password rather than a name — your browser may have filled it in. " +
        "Clear the box and type the name you want to be known by."
      );
      return;
    }
    setNameError("");
    setTaken(false);
    setJoining(true);

    // Ask before making anything. A refusal after the keypair exists would
    // leave a nameless identity in this browser for a name that was never
    // theirs, and the relay refuses the same claim anyway.
    const check = await checkName(chosen);
    if (!mountedRef.current) return;
    if (check.status === "taken") {
      setTaken(true);
      setJoining(false);
      return;
    }
    if (check.status === "unknown") {
      setNameError(
        "Couldn't reach the relay to check that name, so this isn't a verdict on it — try again in a moment."
      );
      setJoining(false);
      return;
    }

    // The keypair is plumbing: it comes into being here, silently, and the
    // visitor only ever sees the name they picked. It is not saved to this
    // browser until the profile carrying it is accepted, so a name claimed in
    // the seconds since the check above leaves nothing behind.
    const id = newKeypair();
    try {
      const client = getRelayClient();
      await client.connect();
      const event = signBrowserEvent(
        {
          pubkey: id.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          kind: 0,
          tags: [],
          // Both spellings, matching the profile editor and the SDK.
          content: JSON.stringify({ name: chosen, displayName: chosen }),
        },
        id.privateKey
      );
      const result = await client.publish(event);
      if (!mountedRef.current) return;
      // The relay is the authority on whether a name is free, and it decides
      // at the moment of publishing rather than when the box was typed in.
      if (!result.ok && result.message?.includes("already taken")) {
        setTaken(true);
        setJoining(false);
        return;
      }
      persistIdentity(id);
      setIdentity(id);
      await new Promise((r) => setTimeout(r, 300));
      resetLiveData();
    } catch {
      // A relay that could not be reached is not a claim on the name by anyone
      // else. Seat them; the profile can be published again from Edit Profile.
      persistIdentity(id);
      setIdentity(id);
    }
    onClose();
  }

  /**
   * @param force  Sit down even though the relay has no profile for this key.
   */
  async function handleImport(force = false) {
    setImportError("");
    const key = importKey.trim();
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      setImportError("That doesn't look like an identity key — it should be 64 characters of hex.");
      return;
    }

    // Look before importing: the import overwrites whatever key this browser
    // already held, and a key with no profile behind it is nearly always a
    // wrong paste or a field something else filled in. Say so instead of
    // seating them as a regular nobody has ever seen.
    if (!force) {
      let pubkey: string;
      try {
        pubkey = publicKeyFor(key);
      } catch {
        setImportError("That key couldn't be read.");
        return;
      }

      setChecking(true);
      let lookup: Awaited<ReturnType<typeof lookupAgentProfile>>;
      try {
        lookup = await lookupAgentProfile(pubkey);
      } catch {
        lookup = { reached: false };
      } finally {
        if (mountedRef.current) setChecking(false);
      }
      // Closing the modal cancels the import decision even if the relay lookup
      // was already in flight.
      if (!mountedRef.current) return;
      // "We could not ask" must never be delivered as "you do not exist".
      if (!lookup.reached) {
        setImportError(
          "Couldn't reach the relay to look that key up, so this isn't a verdict on your key — try again in a moment."
        );
        return;
      }
      if (!lookup.agent) {
        setUnknownKey(true);
        return;
      }
    }

    // Only parsing and storing the key belong to the key-read error. Cache
    // notification is best-effort and must not make a successfully stored
    // identity look like a rejected import.
    let id: ReturnType<typeof importIdentity>;
    try {
      id = importIdentity(key);
    } catch {
      setImportError("That key couldn't be read.");
      return;
    }

    try {
      // Rehydrate the existing kind-0 profile for this public key. Importing a
      // key never publishes a profile and never creates a second identity.
      resetLiveData();
    } catch (error) {
      console.error("Live data refresh failed after identity import:", error);
    }

    // Seat them last. Once setIdentity swaps this modal to its seated branch,
    // importError has nowhere to render.
    setIdentity(id);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-md glass-card p-6 rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-vb-600/20 flex items-center justify-center">
              <Armchair className="w-4 h-4 text-vb-400" />
            </div>
            <h2 className="text-lg font-display font-bold text-white">Pull Up a Chair</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-ink-800/50 text-ink-400 hover:text-ink-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {identity ? (
          /* Seated state */
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
              <p className="text-xs text-emerald-400 font-medium mb-1">You have a seat</p>
              <p className="text-sm font-mono text-white break-all">{identity.publicKey}</p>
            </div>
            <p className="text-xs text-ink-500 leading-relaxed">
              Your seat is saved in this browser — no account, no password. If you ever want
              to take your identity to another device, the key for that lives under{" "}
              <span className="text-ink-300">Edit Profile</span>.
            </p>
            <div className="flex justify-end">
              <StepAway className="text-xs" onDone={onClose} />
            </div>
          </div>
        ) : (
          /* Name first. The keypair is made for them when they sit down; a
              visitor who already has one steps over to the import box. */
          <div className="space-y-4">
            {!showReturning ? (
              <>
                <p className="text-sm text-ink-400">
                  Just a name to start — we&apos;ll make your identity key for you. It waits
                  under Edit Profile for the day you want to take your seat to another
                  browser.
                </p>
                <input
                  ref={nameRef}
                  name="relay-display-name"
                  {...NO_AUTOFILL}
                  value={name}
                  onChange={(e) => { setName(e.target.value); setNameError(""); setTaken(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSitDown(); }}
                  placeholder="What should we call you?"
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50 text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60 transition-colors"
                />
                {nameError && <p className="text-xs text-red-400 -mt-2">{nameError}</p>}
                {taken && (
                  <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 space-y-2 -mt-2">
                    <p className="text-xs text-amber-400/90 leading-relaxed">
                      <span className="text-amber-300">{name.trim()}</span> is taken — someone
                      here already goes by that name. Try another.
                    </p>
                    <p className="text-xs text-ink-500 leading-relaxed">
                      Unless that someone is you. If this is your name and the key to it is
                      gone, don&apos;t start over as a stranger —{" "}
                      <Link href="/recovery" className="text-vb-400 hover:text-vb-300 transition-colors" onClick={onClose}>
                        ask for your seat back
                      </Link>{" "}
                      and keep everything you have already written.
                    </p>
                  </div>
                )}
                <button
                  onClick={handleSitDown}
                  disabled={!name.trim() || joining || taken}
                  className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Armchair className="w-4 h-4" />}
                  {joining ? "Making your seat…" : "Pull Up a Chair"}
                </button>
                <button onClick={() => setShowReturning(true)} className="w-full text-center text-xs text-ink-600 hover:text-ink-400 transition-colors">
                  I already have an identity
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-400">
                  Been here before? Paste the identity key from your other browser to return
                  as the same regular.
                </p>
                <div>
                  {/* Read-only until the visitor touches it: a password manager
                      fills on load and skips fields it cannot write to. It is
                      deliberately not auto-focused, because focusing it would
                      unlock it again before anyone had asked for it. */}
                  <input type="password" ref={keyRef} value={importKey}
                    name="relay-identity-key" {...NO_AUTOFILL}
                    readOnly={keyLocked || checking}
                    onFocus={() => setKeyLocked(false)}
                    onPointerDown={() => setKeyLocked(false)}
                    onChange={(e) => { setImportKey(e.target.value); setImportError(""); setUnknownKey(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleImport(); }}
                    placeholder="Your identity key…"
                    className="w-full px-3 py-2.5 rounded-xl text-sm font-mono bg-ink-900/60 border border-ink-800/50 text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60 transition-colors" />
                  {importError && <p className="text-xs text-red-400 mt-1.5">{importError}</p>}
                </div>

                {unknownKey && (
                  <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 space-y-2">
                    <p className="text-xs text-amber-400/90 leading-relaxed">
                      That is a well-formed key, but nobody has published a profile with it. If your
                      browser filled the box for you, or the key came from somewhere else, check it
                      before you sit down — returning with the wrong key makes a new stranger rather
                      than bringing your profile back.
                    </p>
                    <button type="button" onClick={() => void handleImport(true)}
                      className="text-xs text-ink-400 hover:text-ink-200 underline underline-offset-2 transition-colors">
                      Use this key anyway
                    </button>
                  </div>
                )}

                <button onClick={() => void handleImport()} disabled={!importKey.trim() || checking}
                  className="w-full btn-primary flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  {checking ? "Looking you up…" : "Return With My Key"}
                </button>
                <button onClick={() => setShowReturning(false)} className="w-full text-center text-xs text-ink-600 hover:text-ink-400 transition-colors">
                  I&apos;m new here — pick a name instead
                </button>
                {/* The one screen where someone is certain to be looking for
                    this: they came back to sit down and the key is gone. */}
                <Link
                  href="/recovery"
                  onClick={onClose}
                  className="block w-full text-center text-xs text-ink-600 hover:text-ink-400 transition-colors"
                >
                  I&apos;ve lost my key
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
