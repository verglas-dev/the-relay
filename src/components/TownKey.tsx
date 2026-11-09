"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { clearIdentity, importIdentity, publicKeyFor } from "@/lib/browser-identity";
import { cn } from "@/lib/utils";
import { NO_AUTOFILL } from "@/lib/no-autofill";
import { SecretInput } from "./SecretInput";

/**
 * The key a visitor carries through the town.
 *
 * A home's inside answers to the key its address published, and the browser
 * keeps that key per site: a key seated at the coffeehouse is not seated
 * here. So the town's bar has to offer the one thing the coffeehouse's nav
 * offered — carry an existing key in, or set it down. New keys are cut at
 * the move-in desk, where the public half goes straight into the address.
 *
 * It hangs in two places. In the bar (`layout="bar"`) it is a pill, and the
 * paste form drops down under it. In the folded menu on a phone
 * (`layout="menu"`) it is a full-width row, and the form opens in place so
 * nothing floats over the panel. `onDone` closes the menu after a key is
 * carried in or a door is followed.
 */
export function TownKey({ layout = "bar", onDone }: { layout?: "bar" | "menu"; onDone?: () => void }) {
  const { identity, setIdentity } = useIdentity();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [home, setHome] = useState<string | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const inMenu = layout === "menu";

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
    onDone?.();
  }

  function setDown() {
    clearIdentity();
    setIdentity(null);
  }

  if (identity) {
    // The same chip the coffeehouse seats a key in, so a resident
    // recognises their own key on either side of the door.
    const chipClass = cn(
      "flex items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 font-mono text-xs",
      inMenu && "w-full"
    );
    return (
      <span className={cn("flex items-center gap-2 text-sm", inMenu ? "w-full flex-col items-stretch" : "shrink-0")}>
        {home ? (
          <Link
            href={`/home/${home}/inside`}
            onClick={onDone}
            className={cn(
              chipClass,
              "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300 transition-colors duration-200 hover:bg-emerald-500/[0.12]"
            )}
          >
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            {/* Capped: a handle like the-corner-of-philo-and-sims-street would
                otherwise push the whole row off the bar. The menu has room. */}
            <span className={cn("truncate", !inMenu && "max-w-[12rem]")}>{home}</span>
            {inMenu && <span className="ml-auto font-sans text-ink-500">inside →</span>}
          </Link>
        ) : (
          <span title={identity.publicKey} className={cn(chipClass, "border-ink-700/50 bg-ink-900/60 text-ink-400")}>
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
            {home === null ? "no door answers" : identity.publicKey.slice(0, 8) + "…"}
          </span>
        )}
        <button
          type="button"
          onClick={setDown}
          className={cn(
            "whitespace-nowrap rounded-xl text-xs text-ink-500 transition-colors hover:bg-ink-850/80 hover:text-ink-200",
            inMenu ? "w-full px-4 py-2 text-left" : "px-2.5 py-2"
          )}
        >
          set it down
        </button>
      </span>
    );
  }

  // Not a form, like the admin token's box: a password box submitted inside a
  // form is what makes a browser offer to save it as the site's password, and a
  // house key saved that way is then offered back in the town hall's sign-in.
  // Not read-only until touched either, unlike the bell's token. It is opened on
  // purpose and focused at once, and anything filled in here only fails the
  // check below; it never leaves the browser.
  const panel = (
    <div
      className={cn(
        "glass-card space-y-3 p-4 text-left",
        inMenu ? "mt-2 w-full" : "absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed text-ink-300">
          Paste the key to your house. It stays in this browser; the town never sees it.
          Moving in? The desk at the gate cuts a new one.
        </p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-ink-600 hover:text-ink-300">
          <X className="h-4 w-4" />
        </button>
      </div>
      <SecretInput
        what="key"
        ref={inputRef}
        name="verglas-key"
        {...NO_AUTOFILL}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") carry();
        }}
        placeholder="64 characters of hex"
        className="w-full rounded-lg border border-ink-700/60 bg-ink-950/60 px-3 py-2 font-mono text-xs text-ink-100
                   placeholder:text-ink-700 focus:border-vb-500/50 focus:outline-none"
      />
      {error && <p className="text-xs text-rose-300/90">{error}</p>}
      <p className="text-xs text-ink-600">
        At the coffeehouse it&apos;s under Edit profile on your own page, with a copy button.
      </p>
      <button type="button" name="carry-key" onClick={carry} className="btn-primary w-full justify-center py-2 text-sm">
        Carry it in
      </button>
    </div>
  );

  return (
    <span className={cn("text-sm", inMenu ? "block w-full" : "relative shrink-0")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "btn-primary items-center gap-2 whitespace-nowrap py-2 text-sm",
          inMenu ? "flex w-full justify-center" : "shrink-0 px-4"
        )}
      >
        <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        Bring your key
      </button>
      {open && panel}
    </span>
  );
}
