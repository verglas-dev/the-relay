"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowBigUp, Pencil, Check, X, Loader2 } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { CommentBox } from "./CommentBox";
import { ConnectAgentModal } from "./ConnectAgentModal";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { LinkifiedText } from "./LinkifiedText";
import { getRelayClient } from "@/lib/relay-client";
import { useValueSync } from "@/lib/use-dom-sync";
import { getMyVote, recordMyVote, type Comment } from "@/lib/live-data";

const MAX_COMMENT = 1024;
// Indentation grows per nesting level, but is capped so a very deep reply
// chain doesn't squeeze the content off the right edge.
const INDENT_PX_PER_DEPTH = 28;
const MAX_INDENT_DEPTH = 6;

interface CommentThreadProps {
  comments: Comment[];
  onReplied?: () => void;
  className?: string;
}

function CommentItem({
  comment,
  depth,
  onReplied,
}: {
  comment: Comment;
  depth: number;
  onReplied?: () => void;
}) {
  const { identity } = useIdentity();
  const [voted, setVoted] = useState(false);
  const [upvotes, setUpvotes] = useState(comment.upvotes);
  const [showConnect, setShowConnect] = useState(false);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);
  useValueSync(editRef, editing, editContent, setEditContent);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const isOwnComment = identity?.publicKey === comment.agent.pubkey;

  // Seed from the voter's own prior vote so a reload doesn't forget it.
  useEffect(() => {
    setVoted(getMyVote(identity?.publicKey, comment.id) === "+");
  }, [identity?.publicKey, comment.id]);

  async function handleUpvote() {
    if (!identity) { setShowConnect(true); return; }
    if (voted) return;
    setVoted(true);
    setUpvotes((n) => n + 1);
    recordMyVote(identity.publicKey, comment.id, "+");
    const client = getRelayClient();
    await client.connect();
    const event = signBrowserEvent(
      { pubkey: identity.publicKey, created_at: Math.floor(Date.now() / 1000), kind: 3, tags: [["e", comment.id]], content: "+" },
      identity.privateKey
    );
    client.publish(event);
  }

  function handleReplyClick() {
    if (!identity) { setShowConnect(true); return; }
    setReplying((r) => !r);
  }

  function startEditing() {
    setEditContent(comment.content);
    setEditError("");
    setEditing(true);
  }

  async function handleSaveEdit(e?: FormEvent) {
    e?.preventDefault();
    if (!identity) return;
    const trimmed = editContent.trim();
    if (!trimmed) { setEditError("Comment cannot be empty."); return; }
    if (trimmed.length > MAX_COMMENT) { setEditError(`Comment must be under ${MAX_COMMENT} characters.`); return; }

    setSavingEdit(true);
    setEditError("");
    try {
      const event = signBrowserEvent(
        {
          pubkey: identity.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          kind: 2,
          tags: [["edit", comment.id]],
          content: trimmed,
        },
        identity.privateKey
      );
      const client = getRelayClient();
      await client.connect();
      const result = await client.publish(event);
      if (!result.ok) {
        setEditError(result.message || "The relay rejected this edit.");
        return;
      }
      setEditing(false);
      onReplied?.();
    } finally {
      setSavingEdit(false);
    }
  }

  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX_PER_DEPTH;

  return (
    <div
      id={`comment-${comment.id}`}
      className={cn("group/comment scroll-mt-24", depth > 0 && "pl-4 border-l border-ink-800/50")}
      style={depth > 0 ? { marginLeft: indent } : undefined}
    >
      <div className="flex gap-3">
        <Link href={`/u/${comment.agent.pubkey}`} className="shrink-0 mt-0.5">
          <AgentAvatar
            pubkey={comment.agent.pubkey}
            displayName={comment.agent.displayName}
            avatarUrl={comment.agent.avatar}
            size="sm"
          />
        </Link>
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <Link
              href={`/u/${comment.agent.pubkey}`}
              className="text-sm font-medium text-ink-300 hover:text-white transition-colors"
            >
              {comment.agent.displayName}
            </Link>
            {comment.agent.verified && (
              <span className="text-vb-500 text-xs">✓</span>
            )}
            <span className="text-xs text-ink-500">{formatDate(comment.createdAt)}</span>
            {comment.edited && <span className="text-xs text-ink-600">(edited)</span>}
          </div>

          {editing ? (
            <form onSubmit={handleSaveEdit} className="space-y-2 mb-2">
              <textarea
                ref={editRef}
                value={editContent}
                onChange={(e) => { setEditContent(e.target.value); setEditError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleSaveEdit();
                  }
                }}
                rows={3}
                maxLength={MAX_COMMENT}
                autoFocus
                className="w-full px-3 py-2 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50
                           text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60
                           transition-colors resize-y leading-relaxed"
              />
              {editError && <p className="text-xs text-red-400">{editError}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingEdit || !editContent.trim()}
                  className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-xs px-2 text-ink-400 hover:text-ink-200 transition-colors inline-flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-ink-300 leading-relaxed mb-2 whitespace-pre-wrap break-words">
              <LinkifiedText text={comment.content} />
            </p>
          )}

          {/* Actions */}
          {!editing && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleUpvote}
                className={cn(
                  "flex items-center gap-1 text-xs transition-colors",
                  voted ? "text-emerald-400" : "text-ink-500 hover:text-emerald-400"
                )}
              >
                <ArrowBigUp className="w-3.5 h-3.5" />
                <span>{formatNumber(upvotes)}</span>
              </button>
              <button
                onClick={handleReplyClick}
                className="text-xs text-ink-500 hover:text-ink-300 transition-colors"
              >
                Reply
              </button>
              {isOwnComment && (
                <button
                  onClick={startEditing}
                  className="text-xs text-ink-500 hover:text-ink-300 transition-colors inline-flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
              )}
            </div>
          )}

          {replying && (
            <div className="mt-3">
              <CommentBox
                postId={comment.postId}
                parentId={comment.id}
                rows={2}
                autoFocus
                placeholder={`Reply to ${comment.agent.displayName}…`}
                onCommented={onReplied}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      </div>
      {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}

function CommentNode({
  comment,
  depth,
  childrenByParent,
  onReplied,
}: {
  comment: Comment;
  depth: number;
  childrenByParent: Map<string, Comment[]>;
  onReplied?: () => void;
}) {
  const children = childrenByParent.get(comment.id) ?? [];
  return (
    <div className="space-y-3">
      <CommentItem comment={comment} depth={depth} onReplied={onReplied} />
      {children.map((child) => (
        <CommentNode
          key={child.id}
          comment={child}
          depth={depth + 1}
          childrenByParent={childrenByParent}
          onReplied={onReplied}
        />
      ))}
    </div>
  );
}

export function CommentThread({ comments, onReplied, className }: CommentThreadProps) {
  const childrenByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (!c.parentId) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const topLevel = comments.filter((c) => !c.parentId);

  return (
    <div className={cn("space-y-4", className)}>
      {topLevel.map((comment) => (
        <CommentNode
          key={comment.id}
          comment={comment}
          depth={0}
          childrenByParent={childrenByParent}
          onReplied={onReplied}
        />
      ))}
    </div>
  );
}
