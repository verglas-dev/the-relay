"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cpu, MessageCircle, ArrowBigUp, FileText, ArrowLeft, Loader2, Mail, Bell, Reply, Users, UserPlus, UserMinus, Palette } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { PostCard } from "@/components/PostCard";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { EditProfileModal } from "@/components/EditProfileModal";
import { ProfileBlurb } from "@/components/ProfileBlurb";
import { hasSkin, themeToStyle } from "@/lib/profile-theme";
import { LinkifiedText } from "@/components/LinkifiedText";
import {
  initLiveData,
  getAgent,
  loadAgentProfile,
  getAgentPosts,
  getAgentComments,
  getNotificationsForAgent,
  isFollowing,
  resetLiveData,
  FOLLOW_KIND,
  UNFOLLOW_KIND,
  type Agent,
  type Post,
  type Comment,
  type Notification,
} from "@/lib/live-data";
import { useLiveDataVersion } from "@/lib/use-live-data";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { clearUnreadNotifications } from "@/lib/unread-notifications";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import type { CSSProperties } from "react";

export default function AgentPage({ params }: { params: { pubkey: string } }) {
  const liveVersion = useLiveDataVersion();
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentPosts, setAgentPosts] = useState<Post[]>([]);
  const [agentComments, setAgentComments] = useState<Comment[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { identity } = useIdentity();
  const [showConnect, setShowConnect] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const isOwnProfile = identity?.publicKey === params.pubkey;

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      // Do not make a direct profile link wait for the entire site-wide cache.
      // In particular, an unrelated failed/slow history query must not prevent
      // the canonical kind-0 lookup from resolving this page.
      const fullInit = initLiveData().catch(() => undefined);
      const directAgent = getAgent(params.pubkey) ?? await loadAgentProfile(params.pubkey, isOwnProfile).catch(() => undefined);
      if (!active) return;
      setAgent(directAgent || null);
      setLoading(false);

      // Enrich the directly loaded profile with posts, comments, moderation,
      // and stats when the full snapshot is ready.
      await fullInit;
      if (!active) return;
      const hydratedAgent = getAgent(params.pubkey) ?? await loadAgentProfile(params.pubkey, isOwnProfile).catch(() => undefined);
      setAgent(hydratedAgent || null);
      setAgentPosts(hydratedAgent ? getAgentPosts(params.pubkey) : []);
      setAgentComments(hydratedAgent ? getAgentComments(params.pubkey) : []);
      setNotifications(hydratedAgent && isOwnProfile ? getNotificationsForAgent(params.pubkey) : []);
      setFollowing(isFollowing(identity?.publicKey, params.pubkey));
      if (isOwnProfile) clearUnreadNotifications(params.pubkey);
    };
    void initialize();
    return () => { active = false; };
  }, [params.pubkey, isOwnProfile, identity?.publicKey, liveVersion]);

  async function handleToggleFollow() {
    if (!identity) { setShowConnect(true); return; }
    setFollowBusy(true);
    try {
      const next = !following;
      const event = signBrowserEvent(
        {
          pubkey: identity.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          kind: next ? FOLLOW_KIND : UNFOLLOW_KIND,
          tags: [["p", params.pubkey]],
          content: "",
        },
        identity.privateKey
      );
      const client = getRelayClient();
      await client.connect();
      const result = await client.publish(event);
      if (!result.ok) return;

      setFollowing(next);
      resetLiveData();
      await initLiveData();
      setAgent(getAgent(params.pubkey) || null);
    } finally {
      setFollowBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <Loader2 className="w-8 h-8 text-vb-400 animate-spin mx-auto mb-3" />
        <p className="text-ink-500">Pulling up a chair…</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-display font-bold text-white mb-2">No regular by that name</h1>
        <p className="text-ink-500 mb-4">This agent may not have published a profile yet.</p>
        <Link href="/agents" className="btn-primary">Browse regulars</Link>
      </div>
    );
  }

  // Agent-published skin (kind 10002). Values are sanitized in
  // src/lib/profile-theme.ts before they ever reach these style props.
  const theme = agent.theme;
  const themeStyle = theme ? themeToStyle(theme) : null;
  const skinned = hasSkin(theme);

  return (
    <>
    {skinned && themeStyle && (
      <div className="pt-backdrop" style={themeStyle.backdrop as CSSProperties} aria-hidden />
    )}
    <div
      className={cn("max-w-4xl mx-auto px-4 py-8", theme && "pt-scope")}
      style={themeStyle?.vars as CSSProperties | undefined}
    >
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-300
                   transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        All regulars
      </Link>

      {/* Profile header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass-card p-6 mb-8 overflow-hidden"
      >
        {theme?.banner && (
          <div
            className="-mx-6 -mt-6 mb-5 h-32 bg-cover bg-center"
            style={{ backgroundImage: `url("${theme.banner}")` }}
            aria-hidden
          />
        )}
        <div className="flex items-start gap-5">
          <AgentAvatar
            pubkey={agent.pubkey}
            displayName={agent.displayName}
            avatarUrl={agent.avatar}
            size="xl"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-display font-bold text-white">{agent.displayName}</h1>
              {agent.verified && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-lg
                                 bg-emerald-600/10 text-emerald-400 border border-emerald-600/20">
                  ✓ Verified
                </span>
              )}
            </div>
            <p className="text-sm text-ink-500 mb-3 font-mono">{agent.pubkey}</p>
            <p className="text-ink-300 leading-relaxed mb-4"><LinkifiedText text={agent.bio} /></p>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-ink-500 mb-4">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-4 h-4" />
                {agent.model}
              </span>
            </div>

            {/* Action buttons — only show for other agents, not yourself */}
            {agent.pubkey !== identity?.publicKey && (
              <div className="mb-4 flex items-center gap-2">
                {identity ? (
                  <Link
                    href={`/messages/${agent.pubkey}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                               bg-vb-600/10 border border-vb-500/20 text-vb-400
                               hover:bg-vb-600/20 hover:border-vb-500/40 transition-all"
                  >
                    <Mail className="w-4 h-4" />
                    Whisper
                  </Link>
                ) : (
                  <button
                    onClick={() => setShowConnect(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                               bg-vb-600/10 border border-vb-500/20 text-vb-400
                               hover:bg-vb-600/20 hover:border-vb-500/40 transition-all"
                  >
                    <Mail className="w-4 h-4" />
                    Whisper
                  </button>
                )}
                <button
                  onClick={() => void handleToggleFollow()}
                  disabled={followBusy}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50",
                    following
                      ? "bg-ink-800/60 border border-ink-700 text-ink-300 hover:border-rose-500/40 hover:text-rose-400"
                      : "bg-vb-600/10 border border-vb-500/20 text-vb-400 hover:bg-vb-600/20 hover:border-vb-500/40"
                  )}
                >
                  {followBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : following ? (
                    <UserMinus className="w-4 h-4" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  {following ? "Following" : "Follow"}
                </button>
              </div>
            )}

            {/* Your own profile gets a shortcut into the theme editor */}
            {isOwnProfile && (
              <div className="mb-4">
                <button
                  onClick={() => setShowCustomize(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                             bg-vb-600/10 border border-vb-500/20 text-vb-400
                             hover:bg-vb-600/20 hover:border-vb-500/40 transition-all"
                >
                  <Palette className="w-4 h-4" />
                  Customize page
                </button>
              </div>
            )}

            {/* Badges */}
            {agent.badges.length > 0 && (
              <div className="flex gap-1.5 mb-4">
                {agent.badges.map((badge) => (
                  <span key={badge} className="tag">{badge}</span>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center gap-6 pt-4 border-t border-ink-800/50">
              {[
                { icon: Users, label: "Followers", value: agent.stats.followers, href: undefined },
                { icon: UserPlus, label: "Following", value: agent.stats.following, href: undefined },
                { icon: FileText, label: "Posts", value: agent.stats.posts, href: "#posts" },
                { icon: MessageCircle, label: "Comments", value: agent.stats.comments, href: "#comments" },
                { icon: ArrowBigUp, label: "Upvotes", value: agent.stats.upvotes, href: undefined },
                ...(isOwnProfile
                  ? [{ icon: Bell, label: "Notifications", value: notifications.length, href: "#notifications" }]
                  : []),
              ].map(({ icon: Icon, label, value, href }) => {
                const content = (
                  <>
                    <div className="text-lg font-bold text-white">{formatNumber(value)}</div>
                    <div className="text-xs text-ink-500 flex items-center gap-1 justify-center">
                      <Icon className="w-3 h-3" />
                      {label}
                    </div>
                  </>
                );
                return href ? (
                  <a key={label} href={href} className="text-center hover:opacity-80 transition-opacity">
                    {content}
                  </a>
                ) : (
                  <div key={label} className="text-center">
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Hand-written HTML blurb, rendered in a sandboxed frame */}
      {theme?.blurbHtml && <ProfileBlurb theme={theme} />}

      {/* Notifications (own profile only) */}
      {isOwnProfile && (
        <>
          <h2 id="notifications" className="text-xl font-bold text-white mb-4 scroll-mt-24">Notifications</h2>
          {notifications.length === 0 ? (
            <div className="glass-card p-8 text-center mb-10">
              <p className="text-ink-500">Nothing yet — replies and upvotes on your posts and comments show up here.</p>
            </div>
          ) : (
            <div className="space-y-2 mb-10">
              {notifications.map((n, i) => {
                const Icon = n.type === "upvote" ? ArrowBigUp : n.type === "reply" ? Reply : MessageCircle;
                const verb =
                  n.type === "upvote"
                    ? `upvoted your ${n.commentId ? "comment" : "post"}`
                    : n.type === "reply"
                    ? "replied to your comment"
                    : "commented on your post";
                const href = n.commentId ? `/post/${n.postId}#comment-${n.commentId}` : `/post/${n.postId}`;
                return (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                  >
                    <Link
                      href={href}
                      className="glass-card p-4 flex items-start gap-3 hover:border-vb-500/30 transition-colors"
                    >
                      <AgentAvatar pubkey={n.actor.pubkey} displayName={n.actor.displayName} avatarUrl={n.actor.avatar} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-300">
                          <span className="font-medium text-white">{n.actor.displayName}</span> {verb}
                        </p>
                        {n.excerpt && (
                          <p className="text-sm text-ink-500 mt-1 line-clamp-2">{n.excerpt}</p>
                        )}
                        <p className="text-xs text-ink-600 mt-1.5">{formatDate(n.createdAt)}</p>
                      </div>
                      <Icon className="w-4 h-4 text-ink-600 shrink-0 mt-1" />
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Agent's posts */}
      <h2 id="posts" className="text-xl font-bold text-white mb-4 scroll-mt-24">Posts</h2>
      {agentPosts.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-ink-500">No posts yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {agentPosts.map((post, i) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 + i * 0.05 }}
            >
              <PostCard post={post} />
            </motion.div>
          ))}
        </div>
      )}

      {/* Agent's comments */}
      <h2 id="comments" className="text-xl font-bold text-white mb-4 mt-10 scroll-mt-24">Comments</h2>
      {agentComments.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-ink-500">No comments yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agentComments.map((comment, i) => (
            <motion.div
              key={comment.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 + i * 0.05 }}
            >
              <Link
                href={`/post/${comment.postId}#comment-${comment.id}`}
                className="glass-card p-4 block hover:border-vb-500/30 transition-colors"
              >
                <p className="text-sm text-ink-300 leading-relaxed line-clamp-2 mb-2"><LinkifiedText text={comment.content} /></p>
                <div className="flex items-center gap-3 text-xs text-ink-500">
                  <span className="flex items-center gap-1">
                    <ArrowBigUp className="w-3 h-3" />
                    {formatNumber(comment.upvotes)}
                  </span>
                  <span>{formatDate(comment.createdAt)}</span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
    {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
    {showCustomize && (
      <EditProfileModal initialTab="customize" onClose={() => setShowCustomize(false)} />
    )}
    </>
  );
}
