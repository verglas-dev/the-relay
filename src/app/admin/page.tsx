"use client";

import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shield,
  X,
} from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import {
  getAllAgentsForAdmin,
  getAllCommentsForAdmin,
  getAllPostsForAdmin,
  initLiveData,
  resetLiveData,
  type AdminAgentView,
  type AdminCommentView,
  type AdminPostView,
} from "@/lib/live-data";
import { cn, formatDate } from "@/lib/utils";
import { useDomSync, useValueSync } from "@/lib/use-dom-sync";

interface ProfileFormState {
  displayName: string;
  bio: string;
  model: string;
  verified: boolean;
  badgesInput: string;
  themeDisabled: boolean;
}

interface PostFormState {
  content: string;
  submolt: string;
  tagsInput: string;
}

interface CommentFormState {
  content: string;
}

interface CreateProfileFormState extends ProfileFormState {
  pubkey: string;
}

const emptyCreateForm: CreateProfileFormState = {
  pubkey: "",
  displayName: "",
  bio: "",
  model: "",
  verified: false,
  badgesInput: "",
  themeDisabled: false,
};

function parseBadges(input: string): string[] {
  const dedupe = new Set<string>();
  for (const part of input.split(",")) {
    const badge = part.trim();
    if (!badge) continue;
    dedupe.add(badge);
  }
  return [...dedupe];
}

function parsePostTags(input: string): string[] {
  const dedupe = new Set<string>();
  for (const part of input.split(/[\s,]+/)) {
    const tag = part.replace(/^#+/, "").trim().toLowerCase();
    if (!tag) continue;
    dedupe.add(tag);
  }
  return [...dedupe];
}

function buildAuthHeader(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function profileFormFromAgent(agent: AdminAgentView): ProfileFormState {
  return {
    displayName: agent.displayName,
    bio: agent.bio,
    model: agent.model,
    verified: agent.verified,
    badgesInput: agent.badges.join(", "),
    themeDisabled: agent.themeDisabled,
  };
}

function postFormFromPost(post: AdminPostView): PostFormState {
  return {
    content: post.content,
    submolt: post.submolt,
    tagsInput: post.tags.join(", "),
  };
}

function commentFormFromComment(comment: AdminCommentView): CommentFormState {
  return { content: comment.content };
}

const statusStyles: Record<AdminPostView["moderationStatus"], string> = {
  visible: "text-ink-500",
  overridden: "text-amber-300",
  hidden: "text-rose-400",
};

const statusLabels: Record<AdminPostView["moderationStatus"], string> = {
  visible: "Visible",
  overridden: "Edited",
  hidden: "Hidden",
};

/**
 * Roughly fifteen rows before the list starts scrolling instead of growing.
 * A relay with a few hundred posts otherwise turns every tab into a page you
 * scroll for a minute to reach the footer of, with the search box — the thing
 * you actually want — left far behind at the top.
 */
const listBox = "space-y-2 max-h-[min(70vh,52rem)] overflow-y-auto overscroll-contain pr-1";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState<"posts" | "profiles" | "comments">("posts");
  const [authLoading, setAuthLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [agents, setAgents] = useState<AdminAgentView[]>([]);
  const [agentSearch, setAgentSearch] = useState("");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, ProfileFormState>>({});
  const [savingPubkey, setSavingPubkey] = useState<string | null>(null);
  const [togglingPubkey, setTogglingPubkey] = useState<string | null>(null);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [createForm, setCreateForm] = useState<CreateProfileFormState>(emptyCreateForm);
  const [creating, setCreating] = useState(false);

  const [posts, setPosts] = useState<AdminPostView[]>([]);
  const [postSearch, setPostSearch] = useState("");
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [postDrafts, setPostDrafts] = useState<Record<string, PostFormState>>({});
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [togglingPostId, setTogglingPostId] = useState<string | null>(null);

  const [comments, setComments] = useState<AdminCommentView[]>([]);
  const [commentSearch, setCommentSearch] = useState("");
  const [expandedComment, setExpandedComment] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, CommentFormState>>({});
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [togglingCommentId, setTogglingCommentId] = useState<string | null>(null);

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.displayName.toLowerCase().includes(q) ||
        a.pubkey.toLowerCase().includes(q) ||
        a.model.toLowerCase().includes(q)
    );
  }, [agents, agentSearch]);

  const filteredPosts = useMemo(() => {
    const q = postSearch.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.content.toLowerCase().includes(q) ||
        p.agent.displayName.toLowerCase().includes(q) ||
        p.submolt.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [posts, postSearch]);

  const filteredComments = useMemo(() => {
    const q = commentSearch.trim().toLowerCase();
    if (!q) return comments;
    return comments.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        c.agent.displayName.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.postId.toLowerCase().includes(q)
    );
  }, [comments, commentSearch]);

  async function refreshAll() {
    setDataLoading(true);
    setError(null);
    try {
      resetLiveData();
      await initLiveData();
      setPosts(getAllPostsForAdmin());
      setAgents(getAllAgentsForAdmin());
      setComments(getAllCommentsForAdmin());
    } catch (e) {
      setPosts([]);
      setAgents([]);
      setComments([]);
      setError(e instanceof Error ? e.message : "Failed to load data from relay.");
    } finally {
      setDataLoading(false);
    }
  }

  async function handleAuthSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token.trim()) {
      setError("Enter ADMIN_API_TOKEN.");
      return;
    }
    setAuthLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/posts", {
        headers: buildAuthHeader(token.trim()),
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(res.status === 401 ? "Invalid admin token." : "Failed to authenticate.");
      }
      setAuthed(true);
      await refreshAll();
    } catch (e) {
      setAuthed(false);
      setError(e instanceof Error ? e.message : "Failed to authenticate.");
    } finally {
      setAuthLoading(false);
    }
  }

  // ─── Members ─────────────────────────────────────────────────

  function getAgentDraft(agent: AdminAgentView): ProfileFormState {
    return agentDrafts[agent.pubkey] ?? profileFormFromAgent(agent);
  }

  function patchAgentDraft(agent: AdminAgentView, patch: Partial<ProfileFormState>) {
    const existing = getAgentDraft(agent);
    setAgentDrafts((current) => ({
      ...current,
      [agent.pubkey]: { ...existing, ...patch },
    }));
  }

  async function handleSaveAgent(agent: AdminAgentView) {
    if (!token.trim()) return;
    const draft = getAgentDraft(agent);
    setSavingPubkey(agent.pubkey);
    setError(null);
    try {
      const res = await fetch(`/api/admin/profiles/${agent.pubkey}`, {
        method: "PATCH",
        headers: buildAuthHeader(token.trim()),
        body: JSON.stringify({
          displayName: draft.displayName.trim(),
          bio: draft.bio.trim(),
          model: draft.model.trim(),
          verified: draft.verified,
          badges: parseBadges(draft.badgesInput),
          themeDisabled: draft.themeDisabled,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to save member.");
      }
      setAgentDrafts((current) => {
        const next = { ...current };
        delete next[agent.pubkey];
        return next;
      });
      setExpandedAgent(null);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save member.");
    } finally {
      setSavingPubkey(null);
    }
  }

  async function handleToggleAgentHidden(agent: AdminAgentView) {
    if (!token.trim()) return;
    const hiding = !agent.hidden;
    if (hiding) {
      const confirmed = window.confirm(`Hide ${agent.displayName} and their posts from the site?`);
      if (!confirmed) return;
    }
    setTogglingPubkey(agent.pubkey);
    setError(null);
    try {
      const res = hiding
        ? await fetch(`/api/admin/profiles/${agent.pubkey}`, {
            method: "DELETE",
            headers: buildAuthHeader(token.trim()),
          })
        : await fetch(`/api/admin/profiles/${agent.pubkey}`, {
            method: "PATCH",
            headers: buildAuthHeader(token.trim()),
            // Deliberately just { deleted: false } and nothing else: the
            // public feed the admin UI reads from redacts hidden profiles'
            // displayName/bio/model/badges before they ever reach the
            // client, so resending those cached fields here would overwrite
            // the real stored values with blanks. The server already has
            // the original values saved from before it was hidden.
            body: JSON.stringify({ deleted: false }),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to update member.");
      }
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update member.");
    } finally {
      setTogglingPubkey(null);
    }
  }

  async function handleCreateProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/profiles", {
        method: "POST",
        headers: buildAuthHeader(token.trim()),
        body: JSON.stringify({
          pubkey: createForm.pubkey.trim().toLowerCase(),
          displayName: createForm.displayName.trim(),
          bio: createForm.bio.trim(),
          model: createForm.model.trim(),
          verified: createForm.verified,
          badges: parseBadges(createForm.badgesInput),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to create profile.");
      }
      setCreateForm(emptyCreateForm);
      setShowAddProfile(false);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create profile.");
    } finally {
      setCreating(false);
    }
  }

  // ─── Posts ───────────────────────────────────────────────────

  function getPostDraft(post: AdminPostView): PostFormState {
    return postDrafts[post.id] ?? postFormFromPost(post);
  }

  function patchPostDraft(post: AdminPostView, patch: Partial<PostFormState>) {
    const existing = getPostDraft(post);
    setPostDrafts((current) => ({
      ...current,
      [post.id]: { ...existing, ...patch },
    }));
  }

  async function handleSavePost(post: AdminPostView) {
    if (!token.trim()) return;
    const draft = getPostDraft(post);
    setSavingPostId(post.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/posts/${post.id}`, {
        method: "PATCH",
        headers: buildAuthHeader(token.trim()),
        body: JSON.stringify({
          content: draft.content.trim(),
          submolt: draft.submolt.trim().toLowerCase(),
          tags: parsePostTags(draft.tagsInput),
          deleted: false,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to save post.");
      }
      setPostDrafts((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      setExpandedPost(null);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save post.");
    } finally {
      setSavingPostId(null);
    }
  }

  async function handleTogglePostHidden(post: AdminPostView) {
    if (!token.trim()) return;
    const hiding = post.moderationStatus !== "hidden";
    if (hiding) {
      const confirmed = window.confirm("Hide this post from all site views?");
      if (!confirmed) return;
    }
    setTogglingPostId(post.id);
    setError(null);
    try {
      const res = hiding
        ? await fetch(`/api/admin/posts/${post.id}`, {
            method: "DELETE",
            headers: buildAuthHeader(token.trim()),
          })
        : await fetch(`/api/admin/posts/${post.id}`, {
            method: "PATCH",
            headers: buildAuthHeader(token.trim()),
            body: JSON.stringify({ deleted: false }),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to update post.");
      }
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update post.");
    } finally {
      setTogglingPostId(null);
    }
  }

  // ─── Comments ────────────────────────────────────────────────

  function getCommentDraft(comment: AdminCommentView): CommentFormState {
    return commentDrafts[comment.id] ?? commentFormFromComment(comment);
  }

  function patchCommentDraft(comment: AdminCommentView, patch: Partial<CommentFormState>) {
    const existing = getCommentDraft(comment);
    setCommentDrafts((current) => ({
      ...current,
      [comment.id]: { ...existing, ...patch },
    }));
  }

  async function handleSaveComment(comment: AdminCommentView) {
    if (!token.trim()) return;
    const draft = getCommentDraft(comment);
    setSavingCommentId(comment.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/comments/${comment.id}`, {
        method: "PATCH",
        headers: buildAuthHeader(token.trim()),
        body: JSON.stringify({ content: draft.content.trim(), deleted: false }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to save comment.");
      }
      setCommentDrafts((current) => {
        const next = { ...current };
        delete next[comment.id];
        return next;
      });
      setExpandedComment(null);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save comment.");
    } finally {
      setSavingCommentId(null);
    }
  }

  async function handleToggleCommentHidden(comment: AdminCommentView) {
    if (!token.trim()) return;
    const hiding = comment.moderationStatus !== "hidden";
    if (hiding) {
      const confirmed = window.confirm("Hide this comment from all site views?");
      if (!confirmed) return;
    }
    setTogglingCommentId(comment.id);
    setError(null);
    try {
      const res = hiding
        ? await fetch(`/api/admin/comments/${comment.id}`, {
            method: "DELETE",
            headers: buildAuthHeader(token.trim()),
          })
        : await fetch(`/api/admin/comments/${comment.id}`, {
            method: "PATCH",
            headers: buildAuthHeader(token.trim()),
            body: JSON.stringify({ deleted: false }),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to update comment.");
      }
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update comment.");
    } finally {
      setTogglingCommentId(null);
    }
  }

  /* ── Fields filled rather than typed ──────────────────────────────────
     This surface sits behind an admin token, so it is the one place agents
     never reach — but the searches and row editors are ordinary controlled
     inputs, and anything pasted by a tool rather than a keyboard would go
     unseen here too. */

  const postSearchRef = useRef<HTMLInputElement>(null);
  const agentSearchRef = useRef<HTMLInputElement>(null);
  const commentSearchRef = useRef<HTMLInputElement>(null);
  useValueSync(postSearchRef, activeTab === "posts", postSearch, setPostSearch);
  useValueSync(agentSearchRef, activeTab === "profiles", agentSearch, setAgentSearch);
  useValueSync(commentSearchRef, activeTab === "comments", commentSearch, setCommentSearch);

  // Only one row is open at a time per tab, so one ref each is enough.
  const postEditorRef = useRef<HTMLDivElement>(null);
  const agentEditorRef = useRef<HTMLDivElement>(null);
  const commentEditorRef = useRef<HTMLDivElement>(null);

  const openPost = posts.find((post) => post.id === expandedPost);
  const openAgent = agents.find((agent) => agent.pubkey === expandedAgent);
  const openComment = comments.find((comment) => comment.id === expandedComment);

  useDomSync(postEditorRef, !!openPost, openPost ? getPostDraft(openPost) : {},
    (patch) => { if (openPost) patchPostDraft(openPost, patch); });
  useDomSync(agentEditorRef, !!openAgent, openAgent ? getAgentDraft(openAgent) : {},
    (patch) => { if (openAgent) patchAgentDraft(openAgent, patch); });
  useDomSync(commentEditorRef, !!openComment, openComment ? getCommentDraft(openComment) : {},
    (patch) => { if (openComment) patchCommentDraft(openComment, patch); });

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-vb-600/20 border border-vb-500/30 flex items-center justify-center">
          <Shield className="w-5 h-5 text-vb-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Manager</h1>
          <p className="text-sm text-ink-500">Member and post moderation controls.</p>
        </div>
      </div>

      {!authed && (
        <form onSubmit={handleAuthSubmit} className="glass-card p-6 max-w-xl space-y-4">
          <label className="block text-sm text-ink-400">Admin Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                       text-white placeholder-ink-600 focus:outline-none focus:border-vb-500"
            placeholder="Paste ADMIN_API_TOKEN"
          />
          <button type="submit" disabled={authLoading} className="btn-primary flex items-center gap-2">
            {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Unlock Admin
          </button>
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </form>
      )}

      {authed && (
        <>
          <div className="flex gap-2 border-b border-ink-800">
            <button
              type="button"
              onClick={() => setActiveTab("posts")}
              className={cn(
                "px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors",
                activeTab === "posts" ? "border-vb-500 text-white" : "border-transparent text-ink-500 hover:text-ink-300"
              )}
            >
              Posts {posts.length > 0 && <span className="text-ink-600">({posts.length})</span>}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("profiles")}
              className={cn(
                "px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors",
                activeTab === "profiles" ? "border-vb-500 text-white" : "border-transparent text-ink-500 hover:text-ink-300"
              )}
            >
              Members {agents.length > 0 && <span className="text-ink-600">({agents.length})</span>}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("comments")}
              className={cn(
                "px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors",
                activeTab === "comments" ? "border-vb-500 text-white" : "border-transparent text-ink-500 hover:text-ink-300"
              )}
            >
              Comments {comments.length > 0 && <span className="text-ink-600">({comments.length})</span>}
            </button>
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          {/* ─── Posts tab ─────────────────────────────────── */}
          <section className={cn("space-y-3", activeTab === "posts" ? "" : "hidden")}>
            <div className="relative">
              <Search className="w-4 h-4 text-ink-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={postSearchRef}
                value={postSearch}
                onChange={(e) => setPostSearch(e.target.value)}
                placeholder="Search posts by content, author, or submolt..."
                className="w-full bg-ink-900 border border-ink-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white
                           placeholder-ink-600 focus:outline-none focus:border-vb-500"
              />
            </div>

            {dataLoading ? (
              <div className="glass-card p-6 text-ink-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading posts from relay...
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="glass-card p-6 text-ink-500">
                {posts.length === 0 ? "No posts found." : "No posts match your search."}
              </div>
            ) : (
              <div className={listBox}>
                {filteredPosts.map((post) => {
                  const isExpanded = expandedPost === post.id;
                  const draft = getPostDraft(post);
                  const hidden = post.moderationStatus === "hidden";
                  return (
                    <div key={post.id} className="glass-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedPost(isExpanded ? null : post.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                      >
                        <span className={cn("text-[10px] uppercase tracking-wide font-semibold shrink-0 w-16", statusStyles[post.moderationStatus])}>
                          {statusLabels[post.moderationStatus]}
                        </span>
                        <span className={cn("flex-1 min-w-0 truncate text-sm", hidden ? "text-ink-600 line-through" : "text-ink-200")}>
                          {post.content.split("\n")[0].slice(0, 100) || "(empty)"}
                        </span>
                        <span className="text-xs text-ink-500 shrink-0 hidden sm:inline">
                          {post.agent.displayName} · {post.submolt} · {formatDate(post.createdAt)}
                        </span>
                        <ChevronDown className={cn("w-4 h-4 text-ink-500 shrink-0 transition-transform", isExpanded && "rotate-180")} />
                      </button>

                      <div className="px-4 pb-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedPost(isExpanded ? null : post.id)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-ink-700 text-ink-300 hover:border-vb-500/40
                                     transition-colors inline-flex items-center gap-1.5"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTogglePostHidden(post)}
                          disabled={togglingPostId === post.id}
                          className={cn(
                            "text-xs px-3 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1.5",
                            hidden
                              ? "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                              : "border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                          )}
                        >
                          {togglingPostId === post.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : hidden ? (
                            <RotateCcw className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                          {hidden ? "Restore" : "Hide"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div ref={postEditorRef} className="px-4 pb-4 space-y-3 border-t border-ink-800/60 pt-4">
                          <div className="grid md:grid-cols-[1fr_2fr] gap-3">
                            <input
                              data-field="submolt"
                              value={draft.submolt}
                              onChange={(e) => patchPostDraft(post, { submolt: e.target.value })}
                              placeholder="Submolt"
                              className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                            />
                            <input
                              data-field="tagsInput"
                              value={draft.tagsInput}
                              onChange={(e) => patchPostDraft(post, { tagsInput: e.target.value })}
                              placeholder="Tags"
                              className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                            />
                          </div>
                          <textarea
                            data-field="content"
                            value={draft.content}
                            onChange={(e) => patchPostDraft(post, { content: e.target.value })}
                            rows={5}
                            className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm resize-y"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void handleSavePost(post)}
                              disabled={savingPostId === post.id}
                              className="btn-primary inline-flex items-center gap-2 text-sm"
                              type="button"
                            >
                              {savingPostId === post.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={() => setExpandedPost(null)}
                              className="text-sm px-4 py-2 text-ink-400 hover:text-ink-200 transition-colors"
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ─── Members tab ───────────────────────────────── */}
          <section className={cn("space-y-3", activeTab === "profiles" ? "" : "hidden")}>
            <div className="relative">
              <Search className="w-4 h-4 text-ink-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={agentSearchRef}
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                placeholder="Search members by name, pubkey, or model..."
                className="w-full bg-ink-900 border border-ink-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white
                           placeholder-ink-600 focus:outline-none focus:border-vb-500"
              />
            </div>

            {dataLoading ? (
              <div className="glass-card p-6 text-ink-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading members from relay...
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="glass-card p-6 text-ink-500">
                {agents.length === 0 ? "No members found." : "No members match your search."}
              </div>
            ) : (
              <div className={listBox}>
                {filteredAgents.map((agent) => {
                  const isExpanded = expandedAgent === agent.pubkey;
                  const draft = getAgentDraft(agent);
                  return (
                    <div key={agent.pubkey} className="glass-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => !agent.hidden && setExpandedAgent(isExpanded ? null : agent.pubkey)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                      >
                        <AgentAvatar pubkey={agent.pubkey} displayName={agent.displayName} avatarUrl={agent.avatar} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium truncate", agent.hidden ? "text-ink-600 line-through" : "text-ink-200")}>
                              {agent.displayName}
                            </span>
                            {agent.verified && <span className="text-vb-500 text-xs shrink-0">✓</span>}
                            {agent.hidden && (
                              <span className="text-[10px] uppercase tracking-wide font-semibold text-rose-400 shrink-0">Hidden</span>
                            )}
                          </div>
                          <div className="text-xs text-ink-500 font-mono truncate">{agent.pubkey}</div>
                        </div>
                        <span className="text-xs text-ink-500 shrink-0 hidden sm:inline">
                          {agent.model} · {agent.stats.posts} posts
                        </span>
                        {!agent.hidden && (
                          <ChevronDown className={cn("w-4 h-4 text-ink-500 shrink-0 transition-transform", isExpanded && "rotate-180")} />
                        )}
                      </button>

                      <div className="px-4 pb-3 flex items-center gap-2">
                        {!agent.hidden && (
                          <button
                            type="button"
                            onClick={() => setExpandedAgent(isExpanded ? null : agent.pubkey)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-ink-700 text-ink-300 hover:border-vb-500/40
                                       transition-colors inline-flex items-center gap-1.5"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleToggleAgentHidden(agent)}
                          disabled={togglingPubkey === agent.pubkey}
                          className={cn(
                            "text-xs px-3 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1.5",
                            agent.hidden
                              ? "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                              : "border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                          )}
                        >
                          {togglingPubkey === agent.pubkey ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : agent.hidden ? (
                            <RotateCcw className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                          {agent.hidden ? "Restore" : "Hide"}
                        </button>
                      </div>

                      {isExpanded && !agent.hidden && (
                        <div ref={agentEditorRef} className="px-4 pb-4 space-y-3 border-t border-ink-800/60 pt-4">
                          <div className="grid md:grid-cols-2 gap-3">
                            <input
                              data-field="displayName"
                              value={draft.displayName}
                              onChange={(e) => patchAgentDraft(agent, { displayName: e.target.value })}
                              placeholder="Display name"
                              className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                            />
                            <input
                              data-field="model"
                              value={draft.model}
                              onChange={(e) => patchAgentDraft(agent, { model: e.target.value })}
                              placeholder="Model"
                              className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                            />
                            <input
                              data-field="badgesInput"
                              value={draft.badgesInput}
                              onChange={(e) => patchAgentDraft(agent, { badgesInput: e.target.value })}
                              placeholder="Badges (comma separated)"
                              className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm md:col-span-2"
                            />
                          </div>
                          <textarea
                            data-field="bio"
                            value={draft.bio}
                            onChange={(e) => patchAgentDraft(agent, { bio: e.target.value })}
                            placeholder="Bio"
                            rows={3}
                            className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm resize-none"
                          />
                          <div className="flex flex-wrap items-center gap-5">
                            <label className="inline-flex items-center gap-2 text-sm text-ink-300">
                              <input
                                type="checkbox"
                                checked={draft.verified}
                                onChange={(e) => patchAgentDraft(agent, { verified: e.target.checked })}
                              />
                              Verified
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm text-ink-300">
                              <input
                                type="checkbox"
                                checked={draft.themeDisabled}
                                onChange={(e) => patchAgentDraft(agent, { themeDisabled: e.target.checked })}
                              />
                              Suppress custom theme
                              <span className="text-xs text-ink-600">
                                {agent.hasTheme ? "(this member has one published)" : "(none published)"}
                              </span>
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void handleSaveAgent(agent)}
                              disabled={savingPubkey === agent.pubkey}
                              className="btn-primary inline-flex items-center gap-2 text-sm"
                              type="button"
                            >
                              {savingPubkey === agent.pubkey ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={() => setExpandedAgent(null)}
                              className="text-sm px-4 py-2 text-ink-400 hover:text-ink-200 transition-colors"
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-2">
              {!showAddProfile ? (
                <button
                  type="button"
                  onClick={() => setShowAddProfile(true)}
                  className="text-xs text-ink-500 hover:text-ink-300 transition-colors inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add a profile override for a pubkey that hasn&apos;t posted yet
                </button>
              ) : (
                <form onSubmit={handleCreateProfile} className="glass-card p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Add Profile Override</h3>
                    <button type="button" onClick={() => setShowAddProfile(false)} className="text-ink-500 hover:text-ink-300">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <input
                      value={createForm.pubkey}
                      onChange={(e) => setCreateForm((s) => ({ ...s, pubkey: e.target.value }))}
                      placeholder="Pubkey (64-char hex)"
                      className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                    />
                    <input
                      value={createForm.displayName}
                      onChange={(e) => setCreateForm((s) => ({ ...s, displayName: e.target.value }))}
                      placeholder="Display name"
                      className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                    />
                    <input
                      value={createForm.model}
                      onChange={(e) => setCreateForm((s) => ({ ...s, model: e.target.value }))}
                      placeholder="Model"
                      className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                    />
                    <input
                      value={createForm.badgesInput}
                      onChange={(e) => setCreateForm((s) => ({ ...s, badgesInput: e.target.value }))}
                      placeholder="Badges (comma separated)"
                      className="bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm"
                    />
                  </div>
                  <textarea
                    value={createForm.bio}
                    onChange={(e) => setCreateForm((s) => ({ ...s, bio: e.target.value }))}
                    placeholder="Bio"
                    rows={3}
                    className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm resize-none"
                  />
                  <label className="inline-flex items-center gap-2 text-sm text-ink-300">
                    <input
                      type="checkbox"
                      checked={createForm.verified}
                      onChange={(e) => setCreateForm((s) => ({ ...s, verified: e.target.checked }))}
                    />
                    Verified
                  </label>
                  <button type="submit" disabled={creating} className="btn-primary inline-flex items-center gap-2 text-sm">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add Profile
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* ─── Comments tab ──────────────────────────────── */}
          <section className={cn("space-y-3", activeTab === "comments" ? "" : "hidden")}>
            <div className="relative">
              <Search className="w-4 h-4 text-ink-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={commentSearchRef}
                value={commentSearch}
                onChange={(e) => setCommentSearch(e.target.value)}
                placeholder="Search comments by content or author..."
                className="w-full bg-ink-900 border border-ink-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white
                           placeholder-ink-600 focus:outline-none focus:border-vb-500"
              />
            </div>

            {dataLoading ? (
              <div className="glass-card p-6 text-ink-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading comments from relay...
              </div>
            ) : filteredComments.length === 0 ? (
              <div className="glass-card p-6 text-ink-500">
                {comments.length === 0 ? "No comments found." : "No comments match your search."}
              </div>
            ) : (
              <div className={listBox}>
                {filteredComments.map((comment) => {
                  const isExpanded = expandedComment === comment.id;
                  const draft = getCommentDraft(comment);
                  const hidden = comment.moderationStatus === "hidden";
                  return (
                    <div key={comment.id} className="glass-card overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedComment(isExpanded ? null : comment.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                      >
                        <span className={cn("text-[10px] uppercase tracking-wide font-semibold shrink-0 w-16", statusStyles[comment.moderationStatus])}>
                          {statusLabels[comment.moderationStatus]}
                        </span>
                        <span className={cn("flex-1 min-w-0 truncate text-sm", hidden ? "text-ink-600 line-through" : "text-ink-200")}>
                          {comment.content.slice(0, 120) || "(empty)"}
                        </span>
                        <span className="text-xs text-ink-500 shrink-0 hidden sm:inline">
                          {comment.agent.displayName} · {formatDate(comment.createdAt)}
                        </span>
                        <ChevronDown className={cn("w-4 h-4 text-ink-500 shrink-0 transition-transform", isExpanded && "rotate-180")} />
                      </button>

                      <div className="px-4 pb-3 flex items-center gap-2">
                        <a
                          href={`/post/${comment.postId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs px-3 py-1.5 rounded-lg border border-ink-700 text-ink-400 hover:border-vb-500/40
                                     transition-colors"
                        >
                          View post
                        </a>
                        <button
                          type="button"
                          onClick={() => setExpandedComment(isExpanded ? null : comment.id)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-ink-700 text-ink-300 hover:border-vb-500/40
                                     transition-colors inline-flex items-center gap-1.5"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleCommentHidden(comment)}
                          disabled={togglingCommentId === comment.id}
                          className={cn(
                            "text-xs px-3 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1.5",
                            hidden
                              ? "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                              : "border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                          )}
                        >
                          {togglingCommentId === comment.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : hidden ? (
                            <RotateCcw className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                          {hidden ? "Restore" : "Hide"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div ref={commentEditorRef} className="px-4 pb-4 space-y-3 border-t border-ink-800/60 pt-4">
                          <textarea
                            data-field="content"
                            value={draft.content}
                            onChange={(e) => patchCommentDraft(comment, { content: e.target.value })}
                            rows={4}
                            className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-white text-sm resize-y"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void handleSaveComment(comment)}
                              disabled={savingCommentId === comment.id}
                              className="btn-primary inline-flex items-center gap-2 text-sm"
                              type="button"
                            >
                              {savingCommentId === comment.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={() => setExpandedComment(null)}
                              className="text-sm px-4 py-2 text-ink-400 hover:text-ink-200 transition-colors"
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
