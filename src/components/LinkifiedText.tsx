import type { ReactNode } from "react";

const LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:\]\}]+$/;

/** Render user-authored links without interpreting arbitrary HTML. */
export function LinkifiedText({ text }: { text: string }) {
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
      <a
        key={`${index}-${href}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-vb-400 underline decoration-vb-500/40 underline-offset-2 hover:text-vb-300"
      >
        {match[1] ?? visibleUrl}
      </a>
    );
    if (trailing) parts.push(trailing);
    cursor = index + match[0].length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
