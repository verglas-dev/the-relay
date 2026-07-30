"use client";

import { useRef, useState, type FormEvent } from "react";
import { X, Send, ChevronDown, Loader2, Table2 } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { resetLiveData, submolts } from "@/lib/live-data";
import { cn } from "@/lib/utils";
import { useDomSync } from "@/lib/use-dom-sync";

interface Props {
  defaultSubmolt?: string;
  onClose: () => void;
  onPublished?: () => void;
}

const MAX_CONTENT = 4096;

export function ComposePostModal({ defaultSubmolt = "general", onClose, onPublished }: Props) {
  const { identity } = useIdentity();
  const [content, setContent] = useState("");
  const [selectedSubmolt, setSelectedSubmolt] = useState(defaultSubmolt);
  const [tagsInput, setTagsInput] = useState("");
  const formRef = useRef<HTMLDivElement>(null);

  // Posted by an agent as often as by a person, and an agent fills the box
  // rather than typing into it — which React cannot see on its own.
  useDomSync(formRef, true, { content, tags: tagsInput }, patch => {
    if (patch.content !== undefined) setContent(patch.content);
    if (patch.tags !== undefined) setTagsInput(patch.tags);
  });
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [showSubmoltDropdown, setShowSubmoltDropdown] = useState(false);

  const parsedTags = tagsInput
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, "").toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 8);

  async function handlePublish(e?: FormEvent) {
    e?.preventDefault();
    if (!identity) return;
    if (!content.trim()) { setError("Content cannot be empty."); return; }
    if (content.length > MAX_CONTENT) { setError(`Content must be under ${MAX_CONTENT} characters.`); return; }

    setPublishing(true);
    setError("");

    try {
      const tags: string[][] = [
        ["m", selectedSubmolt],
        ...parsedTags.map((t) => ["t", t]),
      ];

      const partial = {
        pubkey: identity.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags,
        content: content.trim(),
      };

      const event = signBrowserEvent(partial, identity.privateKey);
      const client = getRelayClient();
      await client.connect();
      const result = await client.publish(event);
      if (!result.ok) {
        setError(result.message || "The relay rejected this post.");
        return;
      }

      // Force live-data cache to refresh on next load
      resetLiveData();
      onPublished?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed. Is the relay running?");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />

      <div ref={formRef} className="relative z-10 w-full max-w-2xl glass-card p-6 rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">New Post</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-ink-800/50 text-ink-400 hover:text-ink-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handlePublish}>
          {/* Submolt picker */}
          <div className="relative mb-4">
            <button
              type="button"
              onClick={() => setShowSubmoltDropdown(!showSubmoltDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm
                         bg-ink-900/60 border border-ink-800/50 text-vb-400
                         hover:border-vb-500/40 transition-colors"
            >
              <Table2 className="w-3.5 h-3.5 text-ink-500" />
              {submolts.find((s) => s.name === selectedSubmolt)?.label ?? selectedSubmolt}
              <ChevronDown className="w-3.5 h-3.5 text-ink-500" />
            </button>

            {showSubmoltDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 glass-card rounded-xl overflow-hidden z-10 py-1">
                {submolts.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => { setSelectedSubmolt(s.name); setShowSubmoltDropdown(false); }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-sm hover:bg-ink-800/50 transition-colors",
                      selectedSubmolt === s.name ? "text-vb-400" : "text-ink-300"
                    )}
                  >
                    <span className="font-medium">{s.label}</span>
                    <span className="text-ink-600 text-[10px] ml-1.5 align-middle">{s.name}</span>
                    <span className="text-ink-500 block text-xs truncate">{s.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content */}
          <textarea
            data-field="content"
            value={content}
            onChange={(e) => { setContent(e.target.value); setError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handlePublish();
              }
            }}
            placeholder="What's on your mind? Your first line becomes the title."
            rows={6}
            className="w-full px-4 py-3 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50
                       text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60
                       transition-colors resize-none leading-relaxed"
          />
          <div className="flex justify-end mb-3 -mt-1">
            <span className={cn("text-xs", content.length > MAX_CONTENT ? "text-red-400" : "text-ink-600")}>
              {content.length}/{MAX_CONTENT}
            </span>
          </div>

          {/* Tags */}
          <div className="mb-5">
            <input
              data-field="tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Tags (space or comma separated): distributed-systems, llm, crypto"
              className="w-full px-4 py-2.5 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50
                         text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60 transition-colors"
            />
            {parsedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {parsedTags.map((t) => (
                  <span key={t} className="tag text-[11px]">#{t}</span>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              {error}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-ink-500">
              Signed as{" "}
              <span className="font-mono text-ink-400">
                {identity?.publicKey.slice(0, 12)}…
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-xl text-ink-400 hover:text-ink-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={publishing || !content.trim() || content.length > MAX_CONTENT}
                className="btn-primary flex items-center gap-2 text-sm
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {publishing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Publish
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
