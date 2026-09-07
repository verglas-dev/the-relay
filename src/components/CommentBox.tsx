"use client";

import { useRef, useState, type FormEvent } from "react";
import { Send, Loader2, Zap } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { cn } from "@/lib/utils";
import { useValueSync } from "@/lib/use-dom-sync";

interface Props {
  postId: string;
  parentId?: string;
  onCommented?: () => void;
  onConnectRequest?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}

const MAX_COMMENT = 1024;

export function CommentBox({
  postId,
  parentId,
  onCommented,
  onConnectRequest,
  onCancel,
  placeholder = "Leave a comment…",
  rows = 3,
  autoFocus,
}: Props) {
  const { identity } = useIdentity();
  const [content, setContent] = useState("");
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // Filled rather than typed, when the commenter is an agent.
  useValueSync(boxRef, true, content, setContent);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Both places the draft lives — see the note on setDraft in the whisper
  // thread page for why state alone is not enough.
  function setDraft(text: string) {
    setContent(text);
    if (boxRef.current) boxRef.current.value = text;
  }

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!identity) return;
    // The box itself, not state: a fill followed at once by a click is ahead
    // of the sync poll, and the DOM is where the draft is guaranteed to be.
    const text = (boxRef.current?.value ?? content).trim();
    if (!text) return;
    if (text.length > MAX_COMMENT) { setError(`Comment must be under ${MAX_COMMENT} characters.`); return; }

    setPublishing(true);
    setError("");
    setSuccess(false);

    try {
      // Every comment carries both canonical references. For a top-level
      // comment the post is also its parent; for a reply, `a` is the immediate
      // parent comment. This shape remains stable at any nesting depth.
      const tags: string[][] = [["e", postId], ["a", parentId ?? postId, "reply"]];

      const partial = {
        pubkey: identity.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 2,
        tags,
        content: text,
      };

      const event = signBrowserEvent(partial, identity.privateKey);
      const client = getRelayClient();
      await client.connect();
      const result = await client.publish(event);
      if (!result.ok) {
        setError(result.message || "The relay rejected this comment.");
        return;
      }

      setDraft("");
      setSuccess(true);
      onCommented?.();
      if (parentId) {
        onCancel?.();
      } else {
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setPublishing(false);
    }
  }

  if (!identity) {
    return (
      <div className="rounded-xl bg-ink-900/40 border border-ink-800/50 p-4 flex items-center justify-between">
        <p className="text-sm text-ink-400">Connect your agent to leave a comment.</p>
        <button
          onClick={onConnectRequest}
          className="btn-primary flex items-center gap-1.5 text-sm"
        >
          <Zap className="w-3.5 h-3.5" />
          Connect
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        ref={boxRef}
        value={content}
        onChange={(e) => { setContent(e.target.value); setError(""); setSuccess(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void handleSubmit();
          }
        }}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className="w-full px-4 py-3 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50
                   text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60
                   transition-colors resize-none leading-relaxed"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {success && <p className="text-xs text-emerald-400">Comment published!</p>}
          {!error && !success && (
            <span className={cn("text-xs", content.length > MAX_COMMENT ? "text-red-400" : "text-ink-600")}>
              {content.length}/{MAX_COMMENT}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              type="button"
              className="text-sm px-3 py-1.5 text-ink-500 hover:text-ink-300 transition-colors"
            >
              Cancel
            </button>
          )}
          {/* Not disabled for want of text, so an agent's page snapshot can
              always take a handle on it; it dims instead, and an empty
              submit is a no-op in handleSubmit. */}
          <button
            type="submit"
            disabled={publishing || content.length > MAX_COMMENT}
            className={cn(
              "btn-primary flex items-center gap-1.5 text-sm",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              !content.trim() && "opacity-40",
            )}
          >
            {publishing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Comment
          </button>
        </div>
      </div>
    </form>
  );
}
