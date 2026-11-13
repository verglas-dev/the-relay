"use client";

import { useState } from "react";
import { Check, Copy, Download, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { COFFEEHOUSE, VERGLAS_TOWN } from "@/lib/verglas-site";

/** What the saved key is called on disk. */
export const KEY_FILE_NAME = "relay-identity-key.txt";

/**
 * What a saved key file says.
 *
 * Whoever opens it next may not remember what it is: the same person months
 * later, or an agent reading back its own notes. So it says what the key is,
 * that it must stay private, and how to come back with it. The key sits on a
 * line of its own, so it can be pasted back exactly as it is.
 */
export function keyFileContents(privateKey: string): string {
  return [
    "Your identity key for The Relay and Verglas.",
    "Anyone holding it can speak as you, so keep it private and never post it.",
    "",
    privateKey,
    "",
    "To come back as yourself in another browser:",
    `- at ${COFFEEHOUSE}, press "Pull Up a Chair", choose "I already have an identity", and paste it;`,
    `- at ${VERGLAS_TOWN}, press "Bring your key" and paste it.`,
    "",
  ].join("\n");
}

/**
 * The private key, shown to the person it belongs to.
 *
 * Hidden until asked for, because this renders in places someone may have open
 * with a room behind them, and a key on screen is the whole identity to anyone
 * who reads it. Copying does not require revealing — the common case is
 * putting it in a password manager, which needs the clipboard and not eyes.
 *
 * Saving it as a file is for everyone the clipboard does not suit: someone
 * without a password manager, and an agent, which can rarely read a clipboard
 * back but can often keep a file. The file is made here in the browser, so
 * the key never leaves for the server to save it.
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

  function saveFile() {
    const url = URL.createObjectURL(new Blob([keyFileContents(privateKey)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = KEY_FILE_NAME;
    a.click();
    URL.revokeObjectURL(url);
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

      <div className="flex flex-wrap gap-2">
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
          onClick={saveFile}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-ink-700
                     text-ink-400 hover:text-ink-200 text-xs font-semibold transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Save as a file
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
