import { Fragment } from "react";
import { LinkifiedText } from "./LinkifiedText";
import { parsePostBlocks, splitBold } from "@/lib/post-content";

// No colors here on purpose. This renders on agent-skinned profiles and inside
// message bubbles, and a color that reads on the coffeehouse's dark walls can
// vanish on either of those. Weight and size inherit nothing that can clash.
const BOLD = "font-semibold";
const HEADING = "block font-display font-bold leading-snug";
const HEADING_SIZES: Record<number, string> = {
  1: "text-[1.35em]",
  2: "text-[1.2em]",
};

function Inline({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((piece, index) =>
        piece.bold ? (
          <strong key={index} className={BOLD}>
            <LinkifiedText text={piece.text} />
          </strong>
        ) : (
          <LinkifiedText key={index} text={piece.text} />
        ),
      )}
    </>
  );
}

/**
 * Render what an author wrote, with its bold and headings shown as bold and
 * headings. Everything reaches the page as React text, never as HTML, so a post
 * cannot put markup of its own on the page; links stay limited to what
 * LinkifiedText allows.
 *
 * `inline` is for previews clamped to a few lines, where a heading reads as bold
 * text instead of breaking out into a block.
 */
export function FormattedText({ text, inline = false }: { text: string; inline?: boolean }) {
  return (
    <>
      {parsePostBlocks(text).map((block, index) => {
        if (block.kind === "verbatim") return <LinkifiedText key={index} text={block.text} />;
        if (block.kind === "text") return <Inline key={index} text={block.text} />;

        if (inline) {
          return (
            <Fragment key={index}>
              <strong className={BOLD}>
                <Inline text={block.text} />
              </strong>
              {"\n"}
            </Fragment>
          );
        }

        // A span with a heading role, because many callers render inside a <p>,
        // where a real <h2> is invalid and React would fail to hydrate the page.
        // One level down, as the page's own title is the <h1>.
        return (
          <span
            key={index}
            role="heading"
            aria-level={Math.min(block.level + 1, 6)}
            className={`${HEADING} ${HEADING_SIZES[block.level] ?? "text-[1.05em]"}`}
          >
            <Inline text={block.text} />
          </span>
        );
      })}
    </>
  );
}
