"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { clearIdentity, importIdentity, publicKeyFor } from "@/lib/browser-identity";

/**
 * The key a visitor carries through the town.
 *
 * A home's inside answers to the key its address published, and the browser
 * keeps that key per site: a key seated at the coffeehouse is not seated
 * here. So the town's bar has to offer the one thing the coffeehouse's nav
 * offered — carry an existing key in, or set it down. New keys are cut at
 * the move-in desk, where the public half goes straight into the address.
 */
export function TownKey() {
  const { identity, setIdentity } = useIdentity();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [home, setHome] = useState<string | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Which door this key opens, if any. Public information — the town's
  // addresses are a public repository.
  useEffect(() => {
    if (!identity) return setHome(undefined);
    let live = true;
    fetch(`/api/verglas/resident?pubkey=${identity.publicKey}`)
      .then((r) => r.json())
      .then((data: { handle?: string | null }) => {
        if (live) setHome(data.handle ?? null);
      })
      .catch(() => {
        if (live) setHome(null);
      });
    return () => {
      live = false;
    };
  }, [identity]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function carry() {
    const key = draft.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      setError("A key is 64 characters of hex. Copy it from Edit profile at the coffeehouse.");
      return;
    }
    try {
      publicKeyFor(key);
    } catch {
      setError("That key couldn't be read.");
      return;
    }
    setIdentity(importIdentity(key));
    setDraft("");
    setError("");
    setOpen(false);
  }

  function setDown() {
    clearIdentity();
    setIdentity(null);
  }

  if (identity) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-sm">
        {/* The same chip the coffeehouse seats a key in, so a resident
            recognises their own key on either side of the door. */}
        {home ? (
          <Link
            href={`/home/${home}/inside`}
            className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-emerald-500/20
              bg-emerald-500/[0.06] px-3.5 py-2 font-mono text-xs text-emerald-300
              transition-colors duration-200 hover:bg-emerald-500/[0.12]"
          >
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            {home}
          </Link>
        ) : (
          <span
            title={identity.publicKey}
            className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-ink-700/50
              bg-ink-900/60 px-3.5 py-2 font-mono text-xs text-ink-400"
          >
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            {home === null ? "no door answers" : identity.publicKey.slice(0, 8) + "…"}
          </span>
        )}
        <button
          type="button"
          onClick={setDown}
          className="whitespace-nowrap rounded-xl px-2.5 py-2 text-xs text-ink-500 transition-colors hover:bg-ink-850/80 hover:text-ink-200"
        >
          set it down
        </button>
      </span>
    );
  }

  return (
    <span className="relative shrink-0 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="btn-primary shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-sm"
      >
        <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        Bring your key
      </button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            carry();
          }}
          className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] glass-card p-4 space-y-3 text-left"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-ink-300 leading-relaxed">
              Paste the key to your house. It stays in this browser; the town never sees it.
              Moving in? The desk at the gate cuts a new one.
            </p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-ink-600 hover:text-ink-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            ref={inputRef}
            name="verglas-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError("");
            }}
            placeholder="64 characters of hex"
            className="w-full rounded-lg border border-ink-700/60 bg-ink-950/60 px-3 py-2 font-mono text-xs text-ink-100
                       placeholder:text-ink-700 focus:border-vb-500/50 focus:outline-none"
          />
          {error && <p className="text-xs text-rose-300/90">{error}</p>}
          <p className="text-xs text-ink-600">
            At the coffeehouse it&apos;s under Edit profile on your own page, with a copy button.
          </p>
          <button type="submit" name="carry-key" className="btn-primary w-full justify-center py-2 text-sm">
            Carry it in
          </button>
        </form>
      )}
    </span>
  );
}
