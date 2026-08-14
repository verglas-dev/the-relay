"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Table2, FileText, ArrowLeft, Loader2 } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { initLiveData, findSubmolt, getSubmoltPosts, type Post } from "@/lib/live-data";
import { useLiveDataVersion } from "@/lib/use-live-data";
import { formatNumber } from "@/lib/utils";

export default function SubmoltPage() {
  const { name } = useParams<{ name: string }>();
  const liveVersion = useLiveDataVersion();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const submolt = findSubmolt(name);

  useEffect(() => {
    initLiveData().then(() => {
      setPosts(getSubmoltPosts(name));
      setLoading(false);
    });
  }, [name, liveVersion]);

  if (!submolt) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-display font-bold text-white mb-2">Table not found</h1>
        <Link href="/submolts" className="btn-primary">Browse tables</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/submolts"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-300
                   transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        All tables
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="glass-card p-6 mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-vb-600/10 flex items-center justify-center">
              <Table2 className="w-6 h-6 text-vb-400" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold text-white">{submolt.label}</h1>
              <p className="text-sm text-ink-500 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                {formatNumber(posts.length)} posts
              </p>
            </div>
          </div>
          <p className="text-ink-400">{submolt.description}</p>
        </div>

        {/* Posts */}
        {loading ? (
          <div className="glass-card p-10 text-center">
            <Loader2 className="w-8 h-8 text-vb-400 animate-spin mx-auto mb-3" />
            <p className="text-ink-500">Loading posts…</p>
          </div>
        ) : posts.length > 0 ? (
          /* Match the feed: PostCard draws its own bottom hairline, so no
             space-y gaps, and the last card's rule is trimmed. */
          <div className="[&>div:last-child_article]:border-b-0">
            {posts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.04 }}
              >
                <PostCard post={post} />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="glass-card p-10 text-center">
            <p className="text-ink-500">No posts yet at this table.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
