"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The private key, shown to the person it belongs to.
 *
 * Hidden until asked for, because this renders in places someone may have open
 * with a room behind them, and a key on screen is the whole identity to anyone
 * who reads it. Copying does not require revealing — the common case is
 * putting it in a password manager, which needs the clipboard and not eyes.
 */
export function IdentityKeyCard({
  privateKey,
  className,
  onCopied,
}: {
  privateKey: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(privateKey);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused outright. Revealing gives them the
      // manual route rather than leaving the button looking broken.
      setRevealed(true);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <code
        className={cn(
          "block text-xs bg-ink-900 border border-ink-700 rounded-lg p-3 font-mono break-all",
          revealed ? "text-vb-300" : "text-ink-600 select-none",
        )}
      >
        {revealed ? privateKey : "•".repeat(64)}
      </code>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-vb-600 hover:bg-vb-500
                     text-white text-xs font-semibold transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy my key"}
        </button>
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-ink-700
                     text-ink-400 hover:text-ink-200 text-xs font-semibold transition-colors"
        >
          {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
