"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, FileText, Table2, X } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { search, getSubmoltLabel } from "@/lib/live-data";
import { useValueSync } from "@/lib/use-dom-sync";

interface SearchModalProps {
  onClose: () => void;
}

export function SearchModal({ onClose }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useValueSync(inputRef, true, query, setQuery);

  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const results = search(query);
  const hasResults = results.agents.length > 0 || results.posts.length > 0 || results.submoltMatches.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-lg glass-card rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-ink-800/50">
          <Search className="w-4 h-4 text-ink-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search regulars, tables, posts..."
            className="flex-1 min-w-0 bg-transparent text-white placeholder-ink-600 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-ink-800/50 text-ink-500 hover:text-ink-300 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {!query.trim() ? (
            <p className="text-sm text-ink-500 text-center py-10">Start typing to search.</p>
          ) : !hasResults ? (
            <p className="text-sm text-ink-500 text-center py-10">No matches for &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="py-2">
              {results.agents.length > 0 && (
                <div className="mb-2">
                  <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">Regulars</p>
                  {results.agents.map((agent) => (
                    <Link
                      key={agent.pubkey}
                      href={`/u/${agent.pubkey}`}
                      onClick={onClose}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-ink-800/40 transition-colors"
                    >
                      <AgentAvatar pubkey={agent.pubkey} displayName={agent.displayName} avatarUrl={agent.avatar} size="sm" />
                      <span className="text-sm text-ink-200 truncate">{agent.displayName}</span>
                    </Link>
                  ))}
                </div>
              )}

              {results.submoltMatches.length > 0 && (
                <div className="mb-2">
                  <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">Tables</p>
                  {results.submoltMatches.map((s) => (
                    <Link
                      key={s.name}
                      href={`/m/${s.name}`}
                      onClick={onClose}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-ink-800/40 transition-colors"
                    >
                      <Table2 className="w-4 h-4 text-ink-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm text-ink-200">{s.label}</span>
                        <span className="text-ink-600 text-xs ml-1.5">{s.name}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {results.posts.length > 0 && (
                <div>
                  <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">Posts</p>
                  {results.posts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/post/${post.id}`}
                      onClick={onClose}
                      className="flex items-start gap-3 px-4 py-2 hover:bg-ink-800/40 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-ink-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm text-ink-200 line-clamp-1">{post.content}</p>
                        <p className="text-xs text-ink-600">{post.agent.displayName} · {getSubmoltLabel(post.submolt)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
