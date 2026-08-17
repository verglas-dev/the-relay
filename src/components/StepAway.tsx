"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearIdentity } from "@/lib/browser-identity";
import { useIdentity } from "@/lib/identity-context";
import { IdentityKeyCard } from "./IdentityKeyCard";

/**
 * Forgetting the key this browser carries.
 *
 * There is no server-side session to end — the keypair in localStorage *is*
 * the identity, so this is the whole of logging out, and it is unrecoverable
 * if the private key was never saved anywhere else.
 *
 * The confirm used to say "copy your key first" while offering no way to do it,
 * which is how people walked out without one. It now hands the key over on the
 * way past. Rendered as an overlay rather than inline because this button sits
 * in a navbar row, a profile modal, and a mobile menu, and none of those have
 * room to grow a panel.
 *
 * Portalled to the body because two of those placements are inside a
 * `glass-card`, whose backdrop-filter makes a containing block for fixed
 * children — left in place, the overlay would be trapped inside the card it is
 * meant to cover.
 */
export function StepAway({
  label = "Step away",
  className,
  onDone,
}: {
  label?: string;
  className?: string;
  onDone?: () => void;
}) {
  const { identity, setIdentity } = useIdentity();
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!identity) return null;

  function forget() {
    clearIdentity();
    setIdentity(null);
    setConfirming(false);
    onDone?.();
  }

  return (
    <>
      <button
        type="button"
        title="Forget this key on this browser"
        onClick={() => setConfirming(true)}
        className={cn(
          "flex items-center gap-1.5 transition-colors text-ink-500 hover:text-ink-300",
          className,
        )}
      >
        <LogOut className="w-3.5 h-3.5 shrink-0" />
        {label}
      </button>

      {confirming && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirming(false); }}
        >
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />

          <div className="relative z-10 w-full max-w-md glass-card p-6 rounded-2xl space-y-4">
            <div className="space-y-2">
              <h2 className="text-lg font-display font-bold text-white">Take your key with you</h2>
              <p className="text-sm text-ink-400 leading-relaxed">
                This key <em>is</em> your account. Stepping away forgets it on this browser, and
                nobody — not this site, not the relay, not the person running it — has a copy to
                give you back.
              </p>
              <p className="text-sm text-ink-400 leading-relaxed">
                Save it somewhere you&apos;ll still have in a year and you can sit back down
                anywhere, any time.
              </p>
            </div>

            <IdentityKeyCard privateKey={identity.privateKey} onCopied={() => setCopied(true)} />

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={forget}
                className={cn(
                  "w-full py-2.5 rounded-xl text-sm font-semibold transition-colors",
                  // Unsaved is the dangerous path, so it reads as one. Still
                  // available: someone may have saved the key long ago, and a
                  // button that refuses to work is worse than one that warns.
                  copied
                    ? "bg-ink-800 text-ink-200 hover:bg-ink-700"
                    : "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10",
                )}
              >
                {copied ? "Saved it — step away" : "Step away without saving it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="w-full text-center text-xs text-ink-600 hover:text-ink-400 transition-colors"
              >
                Stay signed in
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
