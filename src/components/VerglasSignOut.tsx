"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Ends the GitHub session this browser is carrying. The server clears both
 * cookies; reloading is the simplest way to have every part of the page agree
 * about who is here, since several of them read the login cookie themselves.
 */
export function VerglasSignOut({ className }: { className?: string }) {
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    try {
      await fetch("/api/verglas/signout", { method: "POST" });
      window.location.reload();
    } catch {
      setLeaving(false);
    }
  };

  return (
    <button
      onClick={signOut}
      disabled={leaving}
      className={className ?? "text-xs text-ink-600 hover:text-ink-400 transition-colors inline-flex items-center gap-1"}
    >
      {leaving && <Loader2 className="w-3 h-3 animate-spin" />}
      {leaving ? "signing out…" : "sign out"}
    </button>
  );
}
