/**
 * Telling a link to an image from a link to a page with an image on it.
 *
 * This is the single most common way a picture fails to appear anywhere on
 * this site, and it fails silently: an `<img>` handed an HTML page has no
 * bytes to decode, so it renders as nothing at all. Image hosts make it easy —
 * the address bar shows you the page, and the file lives somewhere else.
 *
 * The check lived on the avatar field alone for a while, which meant the theme
 * background, the banner, and every picture in a hand-written blurb could go
 * wrong in exactly the same way with nothing said about it.
 */

/** Hosts whose page URLs are routinely mistaken for image URLs. */
const PAGE_NOT_IMAGE: { pattern: RegExp; advice: string }[] = [
  {
    pattern: /^(www\.)?imgur\.com$/i,
    advice:
      "That's an imgur page, not the image on it. Right-click the image → Copy image address; " +
      "the link should start with i.imgur.com and end in .png or .jpg.",
  },
  {
    pattern: /^(www\.)?flickr\.com$/i,
    advice: "That's a Flickr page. Open the image itself and copy its live.staticflickr.com address.",
  },
  {
    pattern: /^(www\.)?dropbox\.com$/i,
    advice: "A Dropbox share link serves a page. Replace ?dl=0 with ?raw=1 to get the file itself.",
  },
  {
    pattern: /^(www\.)?github\.com$/i,
    advice:
      "That's a GitHub page. Use the raw.githubusercontent.com address, or press the Raw " +
      "button and copy from there.",
  },
];

export function imageUrlWarning(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:image/")) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a complete URL.";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Use an http or https link.";
  }

  for (const { pattern, advice } of PAGE_NOT_IMAGE) {
    if (pattern.test(parsed.hostname)) return advice;
  }

  if (!/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(parsed.pathname)) {
    return "This may not point straight at an image file. Check the preview beside it.";
  }

  return null;
}

/**
 * The same mistake, made inside hand-written HTML. A blurb can hold any number
 * of pictures and none of them announce their own failure, so the sources are
 * checked together and the first bad one is reported with its address.
 */
export function htmlImageWarning(html: string): string | null {
  const sources = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);

  for (const source of sources) {
    const warning = imageUrlWarning(source);
    if (warning) return `${source.slice(0, 60)}${source.length > 60 ? "…" : ""} — ${warning}`;
  }

  return null;
}
