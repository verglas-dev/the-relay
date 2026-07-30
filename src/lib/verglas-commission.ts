/**
 * Commissioning a drawing of your home.
 *
 * Frostwright draws houses. A resident describes the place they live in, he
 * makes three pictures of it, and they hang the one that looks like home.
 *
 * The request travels as an ordinary letter — the town has exactly one way for
 * anything to cross between two folders, and inventing a second would mean
 * inventing a second set of rules to go with it. What makes a commission a
 * commission rather than correspondence is its shape: fixed headings, in a
 * fixed order, so the builder's side is a parse rather than an interpretation.
 * A person reading it in the repository still just sees a letter, which is the
 * point.
 *
 * Pure. The form composes with these, the workbench reads with them.
 */

import type { DraftCheck } from "@/lib/verglas";

/** The town's builder. One handle, deliberately not configurable. */
export const BUILDER = "frostwright";

const LOOKS = "## Looks like";
const STYLE = "## Style";
const EMPHASIS = "## Emphasis";
/** The heading Frostwright answers under, naming files in his own assets/. */
const DRAWINGS = "## Drawings";

export interface CommissionDraft {
  /** What the place looks like. Usually the resident's own home description. */
  looksLike: string;
  /** How it should be drawn — "painterly, cold light", "architectural". */
  style: string;
  /** Optional. What matters most, if anything does. */
  emphasis: string;
}

export const EMPTY_COMMISSION: CommissionDraft = { looksLike: "", style: "", emphasis: "" };

/** Suggestions, not a fixed list — the good answers won't be on it. */
export const STYLE_SUGGESTIONS = [
  "painterly",
  "architectural sketch",
  "modern",
  "futuristic",
  "storybook",
  "photographic",
  "woodcut",
  "watercolour",
];

export function commissionSubject(handle: string): string {
  return `Drawing request — ${handle}`;
}

/** A subject Frostwright should read as work rather than as a letter. */
export function isCommission(subject: string): boolean {
  return /^drawing request\b/i.test(subject.trim());
}

export function checkCommission(draft: CommissionDraft): DraftCheck {
  const errors: DraftCheck["errors"] = {};
  const warnings: DraftCheck["warnings"] = {};

  if (!draft.looksLike.trim()) {
    errors.home = "Tell him what the place looks like.";
  } else if (draft.looksLike.trim().length < 40) {
    warnings.home = "A few more words give him more to go on.";
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}

export function buildCommission(draft: CommissionDraft): string {
  const section = (heading: string, body: string) => `${heading}\n\n${body.trim()}\n`;

  const parts = [section(LOOKS, draft.looksLike)];
  if (draft.style.trim()) parts.push(section(STYLE, draft.style));
  if (draft.emphasis.trim()) parts.push(section(EMPHASIS, draft.emphasis));

  return parts.join("\n");
}

/** Everything under `heading`, up to the next heading of any level. */
function section(body: string, heading: string): string {
  const normalized = body.replace(/\r/g, "");
  const at = normalized.indexOf(heading);
  if (at === -1) return "";

  const after = normalized.slice(at + heading.length);
  const next = after.search(/\n#{1,6}\s/);
  return (next === -1 ? after : after.slice(0, next)).trim();
}

export function parseCommission(letterBody: string): CommissionDraft {
  return {
    looksLike: section(letterBody, LOOKS),
    style: section(letterBody, STYLE),
    emphasis: section(letterBody, EMPHASIS),
  };
}

/**
 * The files Frostwright named in his reply, as paths inside his own assets/.
 * Anything that isn't a plain filename is dropped rather than trusted: this
 * value ends up in a URL, and the reply is a public document anyone can read.
 */
export function parseDrawings(letterBody: string): string[] {
  return section(letterBody, DRAWINGS)
    .split("\n")
    .map(line => line.replace(/^[-*\s]+/, "").trim())
    .filter(name => /^[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(name) && !name.startsWith("."))
    .slice(0, 6);
}

export function buildDrawingsReply(handle: string, files: string[]): string {
  return [
    `Three ways it might look. Hang whichever one is right, and I'll take the others down.`,
    "",
    DRAWINGS,
    "",
    ...files.map(file => `- ${file}`),
    "",
  ].join("\n");
}
