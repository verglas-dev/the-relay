"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";

/**
 * A profile section that stops being a wall.
 *
 * A regular who has been here a while has hundreds of posts, so this holds ten
 * rows to start with and grows by ten as you near the end of them. Above a page's
 * worth of rows a search field appears, because scrolling is a fine way to browse
 * and a poor way to find something you already remember.
 *
 * It scrolls with the page. It used to be a box of its own with a section stacked
 * under it, and a pointer resting over the box could not scroll the page past it,
 * so the section below was hard to reach. The bubbles above it show one section
 * at a time now, which is what the box was there to solve.
 */

const PAGE_SIZE = 10;

interface ProfileFeedProps<T> {
  items: T[];
  keyOf: (item: T) => string;
  /** The text a query is matched against — content, tags, wherever it lives. */
  match: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  /** For counts and the search placeholder: "post"/"posts". */
  noun: { one: string; many: string };
  /** Shown when there are none at all, rather than none matching. */
  empty: ReactNode;
  /** Vertical rhythm between rows — posts sit further apart than comments. */
  spacing?: string;
  pageSize?: number;
}

export function ProfileFeed<T>({
  items,
  keyOf,
  match,
  render,
  noun,
  empty,
  spacing = "space-y-4",
  pageSize = PAGE_SIZE,
}: ProfileFeedProps<T>) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Every word has to turn up somewhere in the row, in any order: "amber
  // window" finds the post about the window Amber wrote, not every post
  // containing either word.
  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const filtered = useMemo(() => {
    if (terms.length === 0) return items;
    return items.filter((item) => {
      const haystack = match(item).toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [items, terms, match]);

  // A new query is a new list. Start it at one page.
  useEffect(() => {
    setVisible(pageSize);
  }, [query, pageSize]);

  // Growing on a sentinel rather than on scroll position covers the case where
  // a page of rows is shorter than the window — ten one-line comments may not
  // fill it, so there is no scroll to listen for. The sentinel is simply still
  // in view, and the next batch lands immediately. A hidden bubble's sentinel
  // never intersects, so a section nobody has opened loads nothing more.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visible >= filtered.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible((current) => Math.min(current + pageSize, filtered.length));
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visible, filtered.length, pageSize]);

  if (items.length === 0) return <>{empty}</>;

  const shown = filtered.slice(0, visible);
  const searching = terms.length > 0;
  const plural = (count: number) => (count === 1 ? noun.one : noun.many);

  return (
    <div>
      {items.length > pageSize && (
        <div className="glass-card flex items-center gap-2.5 px-4 py-2.5 mb-3">
          <Search className="w-4 h-4 text-ink-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${items.length} ${plural(items.length)}…`}
            aria-label={`Search ${noun.many}`}
            className="flex-1 min-w-0 bg-transparent text-white placeholder-ink-600
                       text-sm focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="p-1 rounded-lg hover:bg-ink-800/50 text-ink-500
                         hover:text-ink-300 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-ink-500">
            No {noun.many} match &ldquo;{query.trim()}&rdquo;.
          </p>
        </div>
      ) : (
        <>
          <div className={spacing}>
            {shown.map((item, index) => (
              <div key={keyOf(item)}>{render(item, index)}</div>
            ))}
            <div ref={sentinelRef} aria-hidden className="h-px" />
          </div>

          <p className="text-xs text-ink-600 mt-2">
            {searching
              ? `${filtered.length} of ${items.length} ${plural(items.length)} match`
              : `${items.length} ${plural(items.length)}`}
            {shown.length < filtered.length && ` · showing ${shown.length}, scroll for more`}
          </p>
        </>
      )}
    </div>
  );
}
