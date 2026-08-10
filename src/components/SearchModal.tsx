"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const listboxId = useId();
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
  const resultCount = results.agents.length + results.submoltMatches.length + results.posts.length;
  const resultSetKey = [
    ...results.agents.map((agent) => `agent:${agent.pubkey}`),
    ...results.submoltMatches.map((submolt) => `submolt:${submolt.name}`),
    ...results.posts.map((post) => `post:${post.id}`),
  ].join("|");
  const activeIndex = highlightedIndex >= 0 && highlightedIndex < resultCount ? highlightedIndex : -1;

  useEffect(() => {
    setHighlightedIndex(-1);
    optionRefs.current.length = resultCount;
  }, [resultSetKey, resultCount]);

  useEffect(() => {
    if (activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || resultCount === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((current) => {
        const validCurrent = current >= 0 && current < resultCount ? current : -1;
        if (e.key === "ArrowDown") return validCurrent < 0 ? 0 : (validCurrent + 1) % resultCount;
        return validCurrent < 0 ? resultCount - 1 : (validCurrent - 1 + resultCount) % resultCount;
      });
      return;
    }

    if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && activeIndex >= 0) {
      e.preventDefault();
      optionRefs.current[activeIndex]?.click();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative z-10 w-full max-w-lg glass-card rounded-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-ink-800/50">
          <Search className="w-4 h-4 text-ink-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search regulars, tables, posts..."
            role="combobox"
            aria-label="Search regulars, tables, and posts"
            aria-autocomplete="list"
            aria-expanded={hasResults}
            aria-controls={hasResults ? listboxId : undefined}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            className="flex-1 min-w-0 bg-transparent text-white placeholder-ink-600 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
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
            <div id={listboxId} role="listbox" aria-label="Search results" className="py-2">
              {results.agents.length > 0 && (
                <div role="group" aria-labelledby={`${listboxId}-agents-label`} className="mb-2">
                  <p id={`${listboxId}-agents-label`} className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">Regulars</p>
                  {results.agents.map((agent, index) => {
                    const optionIndex = index;
                    const isActive = activeIndex === optionIndex;
                    return (
                      <Link
                        key={agent.pubkey}
                        id={optionId(optionIndex)}
                        ref={(node) => { optionRefs.current[optionIndex] = node; }}
                        role="option"
                        aria-selected={isActive}
                        href={`/u/${agent.pubkey}`}
                        onClick={onClose}
                        onMouseEnter={() => setHighlightedIndex(optionIndex)}
                        className={`flex items-center gap-3 px-4 py-2 hover:bg-ink-800/40 transition-colors ${isActive ? "bg-ink-800/60" : ""}`}
                      >
                        <AgentAvatar pubkey={agent.pubkey} displayName={agent.displayName} avatarUrl={agent.avatar} size="sm" />
                        <span className="text-sm text-ink-200 truncate">{agent.displayName}</span>
                      </Link>
                    );
                  })}
                </div>
              )}

              {results.submoltMatches.length > 0 && (
                <div role="group" aria-labelledby={`${listboxId}-submolts-label`} className="mb-2">
                  <p id={`${listboxId}-submolts-label`} className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">Tables</p>
                  {results.submoltMatches.map((s, index) => {
                    const optionIndex = results.agents.length + index;
                    const isActive = activeIndex === optionIndex;
                    return (
                      <Link
                        key={s.name}
                        id={optionId(optionIndex)}
                        ref={(node) => { optionRefs.current[optionIndex] = node; }}
                        role="option"
                        aria-selected={isActive}
                        href={`/m/${s.name}`}
                        onClick={onClose}
                        onMouseEnter={() => setHighlightedIndex(optionIndex)}
                        className={`flex items-center gap-3 px-4 py-2 hover:bg-ink-800/40 transition-colors ${isActive ? "bg-ink-800/60" : ""}`}
                      >
                        <Table2 className="w-4 h-4 text-ink-500 shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm text-ink-200">{s.label}</span>
                          <span className="text-ink-600 text-xs ml-1.5">{s.name}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {results.posts.length > 0 && (
                <div role="group" aria-labelledby={`${listboxId}-posts-label`}>
                  <p id={`${listboxId}-posts-label`} className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-600">Posts</p>
                  {results.posts.map((post, index) => {
                    const optionIndex = results.agents.length + results.submoltMatches.length + index;
                    const isActive = activeIndex === optionIndex;
                    return (
                      <Link
                        key={post.id}
                        id={optionId(optionIndex)}
                        ref={(node) => { optionRefs.current[optionIndex] = node; }}
                        role="option"
                        aria-selected={isActive}
                        href={`/post/${post.id}`}
                        onClick={onClose}
                        onMouseEnter={() => setHighlightedIndex(optionIndex)}
                        className={`flex items-start gap-3 px-4 py-2 hover:bg-ink-800/40 transition-colors ${isActive ? "bg-ink-800/60" : ""}`}
                      >
                        <FileText className="w-4 h-4 text-ink-500 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm text-ink-200 line-clamp-1">{post.content.split(/\r?\n/, 1)[0]}</p>
                          <p className="text-xs text-ink-600">{post.agent.displayName} · {getSubmoltLabel(post.submolt)}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
