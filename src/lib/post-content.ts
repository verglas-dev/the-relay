export interface PostContentParts {
  headline: string;
  body: string;
}

export type PostBlock =
  | { kind: "text"; text: string }
  | { kind: "verbatim"; text: string }
  | { kind: "heading"; level: number; text: string };

export interface InlinePiece {
  text: string;
  bold: boolean;
}

// The caps below are what keep this cheap. Content is written by strangers and
// runs to 8192 characters, so an unbounded search from every `**` in a post made
// of nothing else would cost every reader's browser quadratic time. Anything past
// a cap simply stays as the author typed it.
const HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.{0,299})$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Code and addresses come first so that their asterisks are not taken for bold.
const INLINE =
  /`[^`\n]{1,1000}`|\[[^\]\n]{1,1000}\]\(https?:\/\/[^\s)]+\)|(?:https?:\/\/|www\.)[^\s<]+|\*\*(?=[^\s*])([^\n]{0,1000}?[^\s*])\*\*(?!\*)/gi;
const WORD_OR_STAR = /[\p{L}\p{N}*]/u;

function readHeading(line: string): { level: number; text: string } | null {
  const match = HEADING.exec(line);
  if (!match) return null;
  // `# Title ##` closes with its own hashes; the one in `# C#` belongs to the word.
  const text = match[2].trimEnd().replace(/(^|[ \t])#+$/, "").trimEnd();
  return text ? { level: match[1].length, text } : null;
}

/**
 * Split content into headings and the runs between them. A `#` needs a space
 * after it, so `#hashtag` stays a hashtag. Newlines are kept exactly, because the
 * pages display them; only the one ending a heading goes, since a heading is a
 * block and already ends its own line. Fenced code is left as written, where
 * `# a comment` is not a heading.
 */
export function parsePostBlocks(content: string): PostBlock[] {
  const blocks: PostBlock[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let run = "";
  let inFence = false;

  const flush = (kind: "text" | "verbatim") => {
    if (run) blocks.push({ kind, text: run });
    run = "";
  };

  lines.forEach((line, index) => {
    const ending = index < lines.length - 1 ? "\n" : "";

    if (FENCE.test(line)) {
      if (!inFence) flush("text");
      run += line + ending;
      if (inFence) flush("verbatim");
      inFence = !inFence;
      return;
    }

    const heading = inFence ? null : readHeading(line);
    if (heading) {
      flush("text");
      blocks.push({ kind: "heading", ...heading });
      return;
    }

    run += line + ending;
  });

  flush(inFence ? "verbatim" : "text");
  return blocks;
}

/**
 * Split a run of text around its `**bold**` spans. Opening asterisks need a
 * non-space after them, closing ones a non-space before, and an opener cannot sit
 * against the end of a word, so `5 ** 2 ** 3` and `x**2 + y**2` keep their
 * meaning. Getting one of these wrong the other way would only leave asterisks
 * showing, which is the better failure.
 */
export function splitBold(text: string): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  let cursor = 0;

  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
    if (match[1] === undefined) continue;

    if (match.index > 0 && WORD_OR_STAR.test(text[match.index - 1])) {
      INLINE.lastIndex = match.index + 2;
      continue;
    }

    if (match.index > cursor) {
      pieces.push({ text: text.slice(cursor, match.index), bold: false });
    }
    pieces.push({ text: match[1], bold: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) pieces.push({ text: text.slice(cursor), bold: false });
  return pieces;
}

/**
 * The same content with its bold and heading markers removed, for places that
 * show one flat line of it: titles, search results, notifications.
 */
export function plainPostText(content: string): string {
  return parsePostBlocks(content)
    .map((block) => {
      if (block.kind === "verbatim") return block.text;
      const text = splitBold(block.text).map((piece) => piece.text).join("");
      return block.kind === "heading" ? `${text}\n` : text;
    })
    .join("")
    .trimEnd();
}

/**
 * Split the first line into the detail-page headline without printing that
 * same line again as body copy. A first line longer than the headline limit is
 * the exception: retain the complete original content as the body so the
 * truncated portion is still readable. The headline is already a heading, so its
 * own markers come off, and before the cut, which could otherwise leave half of
 * a `**` pair on the page.
 */
export function splitPostContent(content: string, headlineMax = 120): PostContentParts {
  const [rawFirstLine = "", ...restLines] = content.split("\n");
  const firstLine = plainPostText(rawFirstLine);
  const headline = firstLine.slice(0, headlineMax);
  const body = firstLine.length > headlineMax
    ? content
    : restLines.join("\n").trim();
  return { headline, body };
}
