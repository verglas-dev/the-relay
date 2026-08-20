/**
 * Reading a room without a person reading it.
 *
 * A guest room is a page one resident wrote and another resident's browser
 * runs. That is the whole appeal, and it is also the oldest hazard on the web:
 * somebody could write a room whose real purpose is to take something from
 * whoever walks in.
 *
 * Three things stand between a visitor and that room, in this order:
 *
 *   1. The sandbox. It runs with no origin of its own — no cookies, no
 *      localStorage, no parent page, nowhere to navigate the tab to. Nothing
 *      here is what keeps a visitor safe; that is.
 *   2. The Content-Security-Policy the room is wrapped in, which forbids it
 *      from loading or contacting anything at all.
 *   3. This file, which reads the room before it is ever stored and refuses
 *      the ones that were clearly trying.
 *
 * **This is a lint, not a proof.** A determined author can obfuscate past any
 * pattern match — `window["fetch"]`, a string assembled from character codes,
 * a name computed at runtime. That is fine, and it is why this is third on the
 * list rather than first: past this check the room still lands in a box with
 * no network and no origin, where the cleverest possible exfiltration has
 * nowhere to send anything.
 *
 * What this does buy, which the sandbox does not:
 *
 *   - It refuses a malicious room *at the door*, so it never reaches a
 *     visitor's browser at all, rather than being defeated inside it.
 *   - It tells an honest author, immediately and specifically, that the thing
 *     they just wrote would not have worked anyway. Most findings here are
 *     mistakes, not attacks.
 *   - It is a second wall. Sandbox flags and CSP headers are one edit away
 *     from being wrong forever, and a wall that only fails when another wall
 *     also fails is worth having.
 *
 * The report goes to the room's author and to nobody else. The town does not
 * publish what it found, does not show the room to an operator, and does not
 * keep a copy of a refused room.
 *
 * Pure: no imports, no I/O, no state. Everything is testable from a string.
 */

/**
 * One file, and a generous one. A room is a page somebody wrote by hand; past
 * this it is an application being smuggled through a mail slot.
 *
 * It lives here rather than beside the store because the editor in the browser
 * has to know it too, and the store reaches for the filesystem.
 */
export const MAX_ROOM_BYTES = 256 * 1024;

export type Severity = "refuse" | "caution";

export interface Finding {
  /** A short name for the thing that was found. */
  rule: string;
  severity: Severity;
  /** 1-indexed line of the room's own source. */
  line: number;
  /** A little of the surrounding text, so the author can find it. */
  excerpt: string;
  /** What it would have done, in the town's words. */
  why: string;
}

export interface SafetyReport {
  /** True when nothing refused. Cautions do not block a save. */
  ok: boolean;
  findings: Finding[];
}

interface Rule {
  name: string;
  severity: Severity;
  pattern: RegExp;
  why: string;
  /** Tags this rule does not apply inside. See `enclosingTag`. */
  notInTags?: string[];
}

/**
 * Which tag a position in the source sits inside, if any.
 *
 * Enough to tell `<a href="https://…">` — a link the frame will never follow,
 * and which costs a visitor nothing — from `<img src="https://…">`, which
 * hands a stranger's server the address of everyone who opens the room. A
 * regex cannot make that distinction on its own, and the difference between a
 * refusal and a shrug is worth ten lines.
 */
function enclosingTag(html: string, index: number): string | null {
  const open = html.lastIndexOf("<", index);
  if (open === -1) return null;
  // A closing bracket in between means the position is between tags, not in one.
  if (html.lastIndexOf(">", index) > open) return null;
  return /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(open, index))?.[1].toLowerCase() ?? null;
}

/**
 * More than this many findings and the list stops being useful. A room that
 * trips forty rules does not need the forty-first explained to it.
 */
const MAX_FINDINGS = 40;

/**
 * Every rule is written against the raw source, comments included.
 *
 * Deliberately: a scanner that skips comments is a scanner you evade by
 * writing code that looks like a comment to it and like code to a browser.
 * The cost is that a room *describing* `fetch()` in prose gets flagged, which
 * is a nuisance rather than a danger, and the message says how to spell around
 * it.
 */
const RULES: Rule[] = [
  /* ── Reaching off the page ─────────────────────────────────────────── */
  {
    name: "an address somewhere else",
    severity: "refuse",
    pattern: /\b(?:src|srcset|href|xlink:href|action|data|poster|formaction)\s*=\s*["']?\s*(?:https?:|ftp:|wss?:|\/\/)/gi,
    // A plain link is handled below instead: it loads nothing by itself, so it
    // costs a visitor nothing, and refusing one would be the town being strict
    // about the wrong thing.
    notInTags: ["a"],
    why: "A room may not load anything from another site — an address in here fetches it the moment somebody opens the room, which tells that site who is visiting. Everything the room needs has to be written into it, or inlined as a data: URI.",
  },
  {
    name: "a stylesheet or script from elsewhere",
    severity: "refuse",
    pattern: /<\s*(?:script|link)\b[^>]*\b(?:src|href)\s*=/gi,
    why: "Scripts and styles live inside the room. A file fetched from somewhere else is a file whose contents can change after the town has checked them.",
  },
  {
    name: "a remote address in CSS",
    severity: "refuse",
    pattern: /url\(\s*["']?\s*(?:https?:|\/\/)/gi,
    why: "A background or font pulled from another site tells that site the address of every visitor who opens your room.",
  },
  {
    name: "@import",
    severity: "refuse",
    pattern: /@import\b/gi,
    why: "An imported stylesheet is a request to somewhere else, and the room has no network.",
  },

  /* ── Calling home ──────────────────────────────────────────────────── */
  {
    name: "a network call",
    severity: "refuse",
    pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|importScripts)\s*\(/g,
    why: "A room cannot talk to anything, and that is the promise it is offered under. Nothing a visitor does inside your room can leave it.",
  },
  {
    name: "sendBeacon",
    severity: "refuse",
    pattern: /\bsendBeacon\b/g,
    why: "This exists to send data out of a page quietly as it closes. That is the one thing a guest room must never be able to do.",
  },
  {
    name: "a service worker",
    severity: "refuse",
    pattern: /\bserviceWorker\b/g,
    why: "A service worker outlives the page that registered it. A room lasts exactly as long as someone is standing in it.",
  },
  {
    name: "loading a script at runtime",
    severity: "refuse",
    pattern: /\bimport\s*\(/g,
    why: "Code fetched while the room is running is code nothing has checked. Write it into the room.",
  },

  /* ── Reaching out of the frame ─────────────────────────────────────── */
  {
    name: "the page around the room",
    severity: "refuse",
    pattern: /\b(?:window\s*\.\s*(?:parent|top|opener)|parent\s*\.\s*(?:location|document|postMessage)|top\s*\.\s*(?:location|document)|\.\s*opener\b)/g,
    why: "The room sits inside the town's page. Reaching for that page is reaching for the visitor's session, and the sandbox refuses it — this is the town saying so earlier and more plainly.",
  },
  {
    name: "postMessage",
    severity: "refuse",
    pattern: /\bpostMessage\s*\(/g,
    why: "A room has nobody to send messages to. Speaking to the page outside it is the beginning of every frame escape there has ever been.",
  },
  {
    name: "somebody else's stored data",
    severity: "refuse",
    pattern: /\b(?:localStorage|sessionStorage|indexedDB|document\s*\.\s*cookie|caches)\b/g,
    why: "This is where a visitor's private key and session live. A room has no origin of its own, so these are empty for it in any case — but asking for them at all is the shape of an attack, and the town will not store a room that does.",
  },
  {
    name: "navigating the visitor somewhere",
    severity: "refuse",
    pattern: /\b(?:location\s*\.\s*(?:href|replace|assign)|window\s*\.\s*open|document\s*\.\s*domain)\b/g,
    why: "A room cannot take a visitor anywhere. Somebody stepped into your house; they leave when they choose to.",
  },
  {
    name: "a nested frame",
    severity: "refuse",
    pattern: /<\s*(?:iframe|object|embed|frame|frameset|portal)\b/gi,
    why: "A room is one page. A frame inside it is a way of putting somebody else's page in front of a visitor who thinks they are still in yours.",
  },
  {
    name: "a <base> or <meta> redirect",
    severity: "refuse",
    pattern: /<\s*(?:base\b|meta\b[^>]*\b(?:http-equiv|charset\s*=\s*["']?utf-7))/gi,
    why: "Both of these change where the page's own addresses point, underneath everything else on it.",
  },

  /* ── Code out of text ──────────────────────────────────────────────── */
  {
    name: "eval",
    severity: "refuse",
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]/g,
    why: "Code built from text at the last moment is code nothing could have read beforehand — including this check, which is exactly why it is refused rather than flagged.",
  },
  {
    name: "a timer given a string",
    severity: "refuse",
    pattern: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g,
    why: "A timer handed a string runs it the way eval does. Hand it a function instead.",
  },

  /* ── Things that are legal, and worth a second thought ─────────────── */
  {
    name: "asking for a key or a password",
    severity: "caution",
    pattern: /\b(?:private\s*key|secret\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|npriv|nsec)\b/gi,
    why: "No room in Verglas ever needs a visitor's private key, and a page asking for one is the oldest trick in this town's short history. If your room is *about* keys this is fine — it is written here so that it is a decision rather than an accident.",
  },
  {
    name: "a password box",
    severity: "caution",
    pattern: /type\s*=\s*["']?password/gi,
    why: "A password the room checks in its own code is a doorway, not a lock — the answer is in the page, and any visitor can read it. That is a fine way to run a puzzle and a poor way to keep a secret. The list of who may open your room is the actual lock.",
  },
  {
    name: "a link out of the room",
    severity: "caution",
    pattern: /<\s*a\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)/gi,
    why: "Harmless — it loads nothing and tells nobody anything — but it will not work either. The frame cannot navigate anywhere, so a guest clicking this gets nothing. Write the address out as text if you want somebody to be able to reach it.",
  },
  {
    name: "an autoplaying sound",
    severity: "caution",
    pattern: /\bautoplay\b/gi,
    why: "A house that makes noise the moment somebody steps inside is a house people leave. Most browsers block it anyway.",
  },
];

/** One line of context around a match, flattened and clipped. */
function excerptAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  const slice = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  return slice.replace(/\s+/g, " ").trim().slice(0, 120);
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at++) if (text.charCodeAt(at) === 10) line++;
  return line;
}

/**
 * Read a room and decide whether the town will hold it.
 *
 * Findings are ordered as they appear in the source, refusals first, and at
 * most one per rule per line — a minified room that says `fetch(` sixty times
 * on one line is one mistake, not sixty.
 */
export function checkRoom(html: string): SafetyReport {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    // Each rule carries /g, so reset before reuse: a lastIndex left over from
    // the previous room would start the next scan partway down the file.
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(html)) !== null) {
      // A zero-width match would spin here forever.
      if (match[0].length === 0) { rule.pattern.lastIndex++; continue; }

      if (rule.notInTags?.includes(enclosingTag(html, match.index) ?? "")) continue;

      const line = lineAt(html, match.index);
      const key = `${rule.name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      findings.push({
        rule: rule.name,
        severity: rule.severity,
        line,
        excerpt: excerptAt(html, match.index, match[0].length),
        why: rule.why,
      });
    }
  }

  findings.sort((a, b) =>
    a.severity === b.severity ? a.line - b.line : a.severity === "refuse" ? -1 : 1);

  return {
    ok: !findings.some((finding) => finding.severity === "refuse"),
    findings: findings.slice(0, MAX_FINDINGS),
  };
}

/** One line for a UI that has room for one line. */
export function summarize(report: SafetyReport): string {
  const refusals = report.findings.filter((f) => f.severity === "refuse").length;
  const cautions = report.findings.length - refusals;
  if (refusals > 0) {
    return `${refusals} thing${refusals === 1 ? "" : "s"} the town will not hold`;
  }
  if (cautions > 0) return `${cautions} thing${cautions === 1 ? "" : "s"} worth a second look`;
  return "Nothing to flag.";
}
