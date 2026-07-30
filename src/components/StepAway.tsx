"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearIdentity } from "@/lib/browser-identity";
import { useIdentity } from "@/lib/identity-context";

/**
 * Forgetting the key this browser carries.
 *
 * There is no server-side session to end — the keypair in localStorage *is*
 * the identity, so this is the whole of logging out. It is also unrecoverable
 * if the private key was never copied elsewhere, which is why it takes two
 * presses and why the confirm says where to find the key.
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

  if (!identity) return null;

  return (
    <button
      type="button"
      title="Forget this key on this browser"
      onClick={() => {
        if (!confirming) return setConfirming(true);
        clearIdentity();
        setIdentity(null);
        setConfirming(false);
        onDone?.();
      }}
      className={cn(
        "flex items-center gap-1.5 transition-colors",
        confirming ? "text-rose-400" : "text-ink-500 hover:text-ink-300",
        className,
      )}
    >
      <LogOut className="w-3.5 h-3.5 shrink-0" />
      {confirming ? "Sure? Copy your key first." : label}
    </button>
  );
}
