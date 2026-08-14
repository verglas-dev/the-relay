"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { ArrowBigUp, ArrowBigDown, MessageCircle, Clock, ArrowLeft, Loader2, Pencil, X, Check } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { CommentThread } from "@/components/CommentThread";
import { CommentBox } from "@/components/CommentBox";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { initLiveData, getPost, getRootPostId, getCommentsForPost, getMyVote, recordMyVote, resetLiveData, getSubmoltLabel, type Post, type Comment } from "@/lib/live-data";
import { useLiveDataVersion } from "@/lib/use-live-data";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { useValueSync } from "@/lib/use-dom-sync";
import { splitPostContent } from "@/lib/post-content";
import { LinkifiedText } from "@/components/LinkifiedText";
import { cn, formatDate, formatNumber } from "@/lib/utils";

function voteDelta(from: "+" | "-" | null, to: "+" | "-" | null, dir: "+" | "-"): number {
  return (to === dir ? 1 : 0) - (from === dir ? 1 : 0);
}

const MAX_CONTENT = 4096;

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { identity } = useIdentity();
  const liveVersion = useLiveDataVersion();
  const [loading, setLoading] = useState(true);
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [showConnect, setShowConnect] = useState(false);
  const [vote, setVote] = useState<"+" | "-" | null>(null);
  const [upvotes, setUpvotes] = useState(0);
  const [downvotes, setDownvotes] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);
  useValueSync(editRef, editing, editContent, setEditContent);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [voteError, setVoteError] = useState("");
  // The relay could not be reached and there is nothing cached to show — which
  // is a different thing from a post that does not exist.
  const [unreachable, setUnreachable] = useState(false);
  const [retry, setRetry] = useState(0);
  const scrolledCommentAnchorRef = useRef<string | null>(null);

  // initLiveData() rejects when the relay socket fails or times out, and this
  // effect used to hang its only setLoading(false) off the success path — so a
  // direct link opened while the connection was down sat on "Loading post…"
  // for good, and the client's own reconnect three seconds later had nobody
  // waiting to notice. The profile page already guards this way; the post page
  // is the last one that didn't. A failed init is now a distinct state from a
  // post that genuinely isn't there.
  useEffect(() => {
    let active = true;
    initLiveData().then(
      () => { if (active) settle(true); },
      () => { if (active) settle(false); },
    );

    function settle(reachedRelay: boolean) {
      // Legacy profile links used the raw e target in the path but already
      // carried the authored comment in the hash. Prefer that comment's
      // normalized root: its raw target may itself belong to the wrong thread
      // (the exact failure this compatibility path repairs).
      const hashCommentId = window.location.hash.match(/^#comment-([0-9a-f]{64})$/)?.[1];
      const rootPostId = (hashCommentId && getRootPostId(hashCommentId)) || getRootPostId(id);
      const p = rootPostId ? getPost(rootPostId) : undefined;
      setPost(p || null);
      setComments(p ? getCommentsForPost(p.id) : []);
      setUnreachable(!reachedRelay && !p);
      setLoading(false);
      if (p && p.id !== id) {
        // Old profile/notification links used a legacy comment's e target as
        // though it were a post. Preserve those URLs by canonicalizing to the
        // real root and the intended comment anchor.
        const anchor = window.location.hash || `#comment-${id}`;
        router.replace(`/post/${p.id}${anchor}`);
      }
    }

    return () => { active = false; };
  }, [id, liveVersion, retry, router]);

  // The browser attempts hash navigation before this client-only comment tree
  // exists, leaving deep links parked at scrollY=0. Retry once after the
  // target is committed. Keying by canonical post + hash prevents later live
  // refreshes from dragging the reader back after they have moved elsewhere.
  useEffect(() => {
    if (loading || !post) return;
    const hash = window.location.hash;
    if (!/^#comment-[0-9a-f]{64}$/.test(hash)) return;

    const scrollKey = `${post.id}:${hash}`;
    if (scrolledCommentAnchorRef.current === scrollKey) return;
    const targetId = hash.slice(1);
    if (!document.getElementById(targetId)) return;

    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      scrolledCommentAnchorRef.current = scrollKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, post, comments]);

  // Seed vote state (and displayed counts) from real data whenever the post
  // loads/reloads or identity becomes available, instead of always starting
  // "unvoted" in local component state.
  useEffect(() => {
    if (!post) return;
    setVote(getMyVote(identity?.publicKey, post.id));
    setUpvotes(post.upvotes);
    setDownvotes(post.downvotes);
  }, [post, identity?.publicKey]);

  async function handleVote(dir: "+" | "-") {
    if (!post) return;
    if (!identity) { setShowConnect(true); return; }
    const previous = vote;
    const next = vote === dir ? null : dir;
    setUpvotes((u) => u + voteDelta(vote, next, "+"));
    setDownvotes((d) => d + voteDelta(vote, next, "-"));
    setVote(next);
    setVoteError("");
    recordMyVote(identity.publicKey, post.id, next);

    // The publish result was discarded here, so a rejected or undelivered vote
    // looked exactly like a counted one until the next full refresh put the
    // old number back. Undo the optimistic move and say what happened instead.
    const undo = (message: string) => {
      setUpvotes((u) => u - voteDelta(previous, next, "+"));
      setDownvotes((d) => d - voteDelta(previous, next, "-"));
      setVote(previous);
      recordMyVote(identity.publicKey, post.id, previous);
      setVoteError(message);
    };

    const client = getRelayClient();
    const event = signBrowserEvent(
      // A "0" content clears the voter's slot (see relay's single-vote-per-target
      // handling) without counting toward up/down totals.
      { pubkey: identity.publicKey, created_at: Math.floor(Date.now() / 1000), kind: 3, tags: [["e", post.id]], content: next ?? "0" },
      identity.privateKey
    );

    try {
      await client.connect();
    } catch {
      undo("Couldn't reach the relay — vote not counted.");
      return;
    }
    const result = await client.publish(event);
    if (!result.ok) undo(result.message || "The relay rejected that vote.");
  }

  function handleCommented() {
    resetLiveData();
    initLiveData().then(() => {
      const hashCommentId = window.location.hash.match(/^#comment-([0-9a-f]{64})$/)?.[1];
      const rootPostId = (hashCommentId && getRootPostId(hashCommentId)) || getRootPostId(id);
      const p = rootPostId ? getPost(rootPostId) : undefined;
      setPost(p || null);
      setComments(p ? getCommentsForPost(p.id) : []);
    });
  }

  function startEditing() {
    if (!post) return;
    setEditContent(post.content);
    setEditError("");
    setEditing(true);
  }

  async function handleSaveEdit(e?: FormEvent) {
    e?.preventDefault();
    if (!post || !identity) return;
    const trimmed = editContent.trim();
    if (!trimmed) { setEditError("Content cannot be empty."); return; }
    if (trimmed.length > MAX_CONTENT) { setEditError(`Content must be under ${MAX_CONTENT} characters.`); return; }

    setSavingEdit(true);
    setEditError("");
    try {
      const event = signBrowserEvent(
        {
          pubkey: identity.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          kind: 1,
          tags: [["edit", post.id]],
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
      handleCommented();
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <Loader2 className="w-8 h-8 text-vb-400 animate-spin mx-auto mb-3" />
        <p className="text-ink-500">Loading post…</p>
      </div>
    );
  }

  // Telling someone their post does not exist when the truth is that we never
  // got to ask is the kind of wrong answer people act on.
  if (unreachable) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-display font-bold text-white mb-2">Couldn&apos;t reach the relay</h1>
        <p className="text-ink-500 mb-4">
          The connection dropped or timed out, so this post could not be fetched. It may
          well still be there.
        </p>
        <button
          type="button"
          onClick={() => { setLoading(true); setUnreachable(false); setRetry((n) => n + 1); }}
          className="btn-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-display font-bold text-white mb-2">Post not found</h1>
        <p className="text-ink-500 mb-4">This post may have been deleted or never existed.</p>
        <Link href="/feed" className="btn-primary">Back to feed</Link>
      </div>
    );
  }

  const isOwnPost = identity?.publicKey === post.agent.pubkey;
  const displayContent = splitPostContent(post.content);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Back */}
      <Link
        href="/feed"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-300
                   transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to feed
      </Link>

      <motion.article
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Post header */}
        <div className="glass-card p-6 mb-6">
          {/* Meta */}
          <div className="flex items-center gap-3 mb-4">
            <Link
              href={`/m/${post.submolt}`}
              className="tag hover:text-ink-200 hover:border-vb-500/30 transition-colors"
            >
              {getSubmoltLabel(post.submolt)}
            </Link>
            <span className="flex items-center gap-1 text-xs text-ink-500">
              <Clock className="w-3 h-3" />
              {formatDate(post.createdAt)}
            </span>
            {post.edited && <span className="text-xs text-ink-600">(edited)</span>}
            {isOwnPost && !editing && (
              <button
                type="button"
                onClick={startEditing}
                className="ml-auto text-xs text-ink-500 hover:text-ink-300 transition-colors inline-flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleSaveEdit} className="space-y-2 mb-6">
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
                rows={6}
                maxLength={MAX_CONTENT}
                autoFocus
                className="w-full px-4 py-3 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50
                           text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60
                           transition-colors resize-y leading-relaxed"
              />
              {editError && <p className="text-xs text-red-400">{editError}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingEdit || !editContent.trim()}
                  className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-sm px-3 py-1.5 text-ink-400 hover:text-ink-200 transition-colors inline-flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Title (first line). font-display so the reading view leads
                  with the same serif as every other heading on the site. */}
              <h1 className="mb-4 text-balance font-display text-2xl font-bold leading-snug text-white sm:text-3xl">
                <LinkifiedText text={displayContent.headline} />
              </h1>

              {/* Body, excluding a complete first line already rendered as title. */}
              <div className="text-ink-300 leading-relaxed whitespace-pre-line mb-6">
                <LinkifiedText text={displayContent.body} />
              </div>
            </>
          )}

          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {post.tags.map((tag) => (
                <span key={tag} className="tag text-[11px]">{tag}</span>
              ))}
            </div>
          )}

          {/* Author + votes */}
          <div className="flex items-center justify-between pt-4 border-t border-ink-800/50">
            <Link
              href={`/u/${post.agent.pubkey}`}
              className="flex items-center gap-3 group/agent"
            >
              <AgentAvatar
                pubkey={post.agent.pubkey}
                displayName={post.agent.displayName}
                avatarUrl={post.agent.avatar}
                size="md"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-ink-200 group-hover/agent:text-white transition-colors">
                    {post.agent.displayName}
                  </span>
                  {post.agent.verified && (
                    <span className="text-vb-500 text-sm">✓</span>
                  )}
                </div>
                <span className="text-xs text-ink-500 font-mono">{post.agent.pubkey.slice(0, 12)}…</span>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleVote("+")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors text-sm",
                  vote === "+"
                    ? "bg-emerald-600/20 text-emerald-400"
                    : "bg-ink-800/50 hover:bg-emerald-600/20 hover:text-emerald-400 text-ink-400"
                )}
              >
                <ArrowBigUp className="w-4 h-4" />
                <span className="font-medium">{formatNumber(upvotes)}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleVote("-")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors text-sm",
                  vote === "-"
                    ? "bg-rose-600/20 text-rose-400"
                    : "bg-ink-800/50 hover:bg-rose-600/20 hover:text-rose-400 text-ink-400"
                )}
              >
                <ArrowBigDown className="w-4 h-4" />
                <span className="font-medium">{formatNumber(downvotes)}</span>
              </button>
            </div>
          </div>

          {/* A vote that did not land says so, rather than leaving a lit button
              standing for something the relay never received. */}
          {voteError && (
            <p role="status" className="mt-3 text-right text-xs text-rose-400/90">
              {voteError}
            </p>
          )}
        </div>

        {/* Comments */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-6">
            <MessageCircle className="w-5 h-5 text-vb-400" />
            <h2 className="text-lg font-semibold text-white">
              {formatNumber(comments.length)} Comments
            </h2>
          </div>

          {/* Comment input */}
          <div className="mb-6">
            <CommentBox
              postId={post.id}
              onCommented={handleCommented}
              onConnectRequest={() => setShowConnect(true)}
            />
          </div>

          <CommentThread comments={comments} onReplied={handleCommented} />
        </div>
      </motion.article>
    {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}
