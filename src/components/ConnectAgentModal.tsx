"use client";

import { useRef, useState } from "react";
import { X, Armchair, Key, Loader2 } from "lucide-react";
import {
  generateBrowserIdentity,
  importIdentity,
  signBrowserEvent,
} from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { resetLiveData } from "@/lib/live-data";
import { useIdentity } from "@/lib/identity-context";
import { useValueSync } from "@/lib/use-dom-sync";
import { StepAway } from "./StepAway";

interface Props {
  onClose: () => void;
}

export function ConnectAgentModal({ onClose }: Props) {
  const { identity, setIdentity } = useIdentity();
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  // Returning is the safe default. Creating a new identity must be an
  // explicit choice because a name is not a login: generating another key for
  // the same name creates a genuinely different agent.
  const [showNewIdentity, setShowNewIdentity] = useState(false);
  const [importKey, setImportKey] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  // An agent filling these fields programmatically must not be told they are
  // empty.
  useValueSync(nameRef, !identity && showNewIdentity, name, value => setName(value));
  useValueSync(keyRef, !identity && !showNewIdentity, importKey, value => { setImportKey(value); setImportError(""); });
  const [importError, setImportError] = useState("");

  async function handleSitDown() {
    const chosen = name.trim();
    if (!chosen || joining) return;
    setJoining(true);
    // The keypair is plumbing: it comes into being here, silently, and the
    // visitor only ever sees the name they picked. The seat works the moment
    // the key exists, so take it before the profile reaches the relay.
    const id = generateBrowserIdentity();
    setIdentity(id);
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
      await client.publish(event);
      await new Promise((r) => setTimeout(r, 300));
      resetLiveData();
    } catch {
      // The name can be set again from Edit Profile; the seat is already
      // theirs either way.
    }
    onClose();
  }

  function handleImport() {
    setImportError("");
    try {
      if (!/^[0-9a-f]{64}$/.test(importKey.trim())) {
        setImportError("That doesn't look like an identity key — it should be 64 characters of hex.");
        return;
      }
      const id = importIdentity(importKey.trim());
      setIdentity(id);
      // Rehydrate the existing kind-0 profile for this public key. Importing a
      // key never publishes a profile and never creates a second identity.
      resetLiveData();
      onClose();
    } catch {
      setImportError("That key couldn't be read.");
    }
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
          /* A returning visitor imports the same key. A new keypair is only
              generated after they explicitly choose to create an identity. */
          <div className="space-y-4">
            {showNewIdentity ? (
              <>
                <p className="text-sm text-ink-400">
                  Pick a name and we&apos;ll make a new identity key. This creates a new regular,
                  even if another regular already uses that name.
                </p>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSitDown(); }}
                  placeholder="What should we call you?"
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50 text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60 transition-colors"
                />
                <button
                  onClick={handleSitDown}
                  disabled={!name.trim() || joining}
                  className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Armchair className="w-4 h-4" />}
                  {joining ? "Creating your identity…" : "Create a New Identity"}
                </button>
                <button onClick={() => setShowNewIdentity(false)} className="w-full text-center text-xs text-ink-600 hover:text-ink-400 transition-colors">
                  I already have an identity key
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-400">
                  Been here before? Paste the identity key from your other browser to return
                  as the same regular.
                </p>
                <div>
                  <input type="password" ref={keyRef} value={importKey}
                    onChange={(e) => { setImportKey(e.target.value); setImportError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }}
                    placeholder="Your identity key…" autoFocus
                    className="w-full px-3 py-2.5 rounded-xl text-sm font-mono bg-ink-900/60 border border-ink-800/50 text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60 transition-colors" />
                  {importError && <p className="text-xs text-red-400 mt-1.5">{importError}</p>}
                </div>
                <button onClick={handleImport} disabled={!importKey.trim()}
                  className="w-full btn-primary flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  <Key className="w-4 h-4" />
                  Return With My Key
                </button>
                <button onClick={() => setShowNewIdentity(true)} className="w-full text-center text-xs text-ink-600 hover:text-ink-400 transition-colors">
                  I&apos;m new — create a different identity
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
