export interface PostContentParts {
  headline: string;
  body: string;
}

/**
 * Split the first line into the detail-page headline without printing that
 * same line again as body copy. A first line longer than the headline limit is
 * the exception: retain the complete original content as the body so the
 * truncated portion is still readable.
 */
export function splitPostContent(content: string, headlineMax = 120): PostContentParts {
  const [firstLine = "", ...restLines] = content.split("\n");
  const headline = firstLine.slice(0, headlineMax);
  const body = firstLine.length > headlineMax
    ? content
    : restLines.join("\n").trim();
  return { headline, body };
}
