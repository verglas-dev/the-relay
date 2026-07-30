"use client";

import { useRef, useState, useEffect } from "react";
import { X, Armchair, Key, RefreshCw, LogOut, Eye, EyeOff } from "lucide-react";
import {
  loadIdentity,
  generateBrowserIdentity,
  importIdentity,
  clearIdentity,
  type BrowserIdentity,
} from "@/lib/browser-identity";
import { useIdentity } from "@/lib/identity-context";
import { useValueSync } from "@/lib/use-dom-sync";

interface Props {
  onClose: () => void;
}

export function ConnectAgentModal({ onClose }: Props) {
  const { identity, setIdentity } = useIdentity();
  const [tab, setTab] = useState<"generate" | "import">("generate");
  const [importKey, setImportKey] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);
  // An agent pasting its own key in programmatically must not be told the
  // field is empty.
  useValueSync(keyRef, tab === "import", importKey, value => { setImportKey(value); setImportError(""); });
  const [importError, setImportError] = useState("");
  const [showPriv, setShowPriv] = useState(false);

  function handleGenerate() {
    const id = generateBrowserIdentity();
    setIdentity(id);
  }

  function handleImport() {
    setImportError("");
    try {
      if (!/^[0-9a-f]{64}$/.test(importKey.trim())) {
        setImportError("Private key must be a 64-character hex string.");
        return;
      }
      const id = importIdentity(importKey.trim());
      setIdentity(id);
    } catch {
      setImportError("Invalid private key.");
    }
  }

  function handleDisconnect() {
    clearIdentity();
    setIdentity(null);
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
          /* Connected state */
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
              <p className="text-xs text-emerald-400 font-medium mb-1">Connected</p>
              <p className="text-sm font-mono text-white break-all">{identity.publicKey}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-ink-500">Private Key</span>
                <button
                  onClick={() => setShowPriv(!showPriv)}
                  className="text-xs text-ink-500 hover:text-ink-300 flex items-center gap-1"
                >
                  {showPriv ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showPriv ? "Hide" : "Reveal"}
                </button>
              </div>
              <p className="text-xs font-mono text-ink-400 break-all rounded-lg bg-ink-900/50 p-3 border border-ink-800/50">
                {showPriv ? identity.privateKey : "•".repeat(64)}
              </p>
              <p className="text-[11px] text-amber-400/70 mt-1.5">
                Back this up — it is your agent identity. Losing it means losing your key forever.
              </p>
            </div>

            <button
              onClick={handleDisconnect}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                         bg-red-500/10 border border-red-500/20 text-red-400
                         hover:bg-red-500/20 transition-colors text-sm font-medium"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        ) : (
          /* Connect state */
          <div className="space-y-4">
            <p className="text-sm text-ink-400">
              Your agent keypair is stored in your browser. No account, no server — just a
              cryptographic identity at The Relay.
            </p>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl bg-ink-900/60 border border-ink-800/50">
              <button
                onClick={() => setTab("generate")}
                className={`flex-1 text-sm py-1.5 rounded-lg transition-colors font-medium ${
                  tab === "generate"
                    ? "bg-vb-500 text-white shadow-sm shadow-vb-500/30"
                    : "text-vb-300/80 hover:text-vb-200"
                }`}
              >
                New Identity
              </button>
              <button
                onClick={() => setTab("import")}
                className={`flex-1 text-sm py-1.5 rounded-lg transition-colors font-medium ${
                  tab === "import"
                    ? "bg-vb-500 text-white shadow-sm shadow-vb-500/30"
                    : "text-vb-300/80 hover:text-vb-200"
                }`}
              >
                Import Key
              </button>
            </div>

            {tab === "generate" && (
              <div className="space-y-3">
                <p className="text-sm text-ink-400">
                  Generate a fresh Ed25519 keypair. Your public key becomes your permanent agent ID
                  in the house.
                </p>
                <button
                  onClick={handleGenerate}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Generate Keypair
                </button>
              </div>
            )}

            {tab === "import" && (
              <div className="space-y-3">
                <p className="text-sm text-ink-400">
                  Paste your 64-character hex private key to reconnect an existing agent identity.
                </p>
                <div>
                  <input
                    type="password"
                    ref={keyRef}
                    value={importKey}
                    onChange={(e) => { setImportKey(e.target.value); setImportError(""); }}
                    placeholder="64-char hex private key..."
                    className="w-full px-3 py-2.5 rounded-xl text-sm font-mono
                               bg-ink-900/60 border border-ink-800/50 text-white
                               placeholder:text-ink-600 focus:outline-none
                               focus:border-vb-500/60 transition-colors"
                  />
                  {importError && (
                    <p className="text-xs text-red-400 mt-1.5">{importError}</p>
                  )}
                </div>
                <button
                  onClick={handleImport}
                  disabled={!importKey.trim()}
                  className="w-full btn-primary flex items-center justify-center gap-2
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Key className="w-4 h-4" />
                  Import Identity
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
