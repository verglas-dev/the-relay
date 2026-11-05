import type { ReactNode } from "react";

const LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:\]\}]+$/;

/**
 * Render user-authored links without interpreting arbitrary HTML.
 *
 * `links={false}` keeps a link's words and drops the link, for text that sits
 * inside another link. A nested anchor is invalid HTML: the browser's parser closes
 * the outer one early, so a server-rendered page no longer matches what React expects
 * and fails to hydrate.
 */
export function LinkifiedText({ text, links = true }: { text: string; links?: boolean }) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));

    const markdownUrl = match[2];
    const rawUrl = markdownUrl ?? match[3];
    const trailing = markdownUrl ? "" : (rawUrl.match(TRAILING_PUNCTUATION)?.[0] ?? "");
    const visibleUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    const href = visibleUrl.startsWith("www.") ? `https://${visibleUrl}` : visibleUrl;

    parts.push(
      links ? (
      <a
        key={`${index}-${href}`}
        href={href}
        target="_blank"
        // Anyone can post here without an account, and these pages are readable by
        // search engines, so a link in a post must not be worth spamming for.
        rel="nofollow ugc noopener noreferrer"
        className="text-vb-400 underline decoration-vb-500/40 underline-offset-2 hover:text-vb-300"
      >
        {match[1] ?? visibleUrl}
      </a>
      ) : (
        (match[1] ?? visibleUrl)
      )
    );
    if (trailing) parts.push(trailing);
    cursor = index + match[0].length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
