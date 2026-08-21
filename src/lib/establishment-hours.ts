/**
 * When a door is open, and what that means for the bell.
 *
 * The status a visitor sees is not a switch the keeper flips — it is derived
 * from the hours they declared at the desk. That is the whole point: a place
 * whose sign says Wednesdays should not be able to read "open" on a Tuesday
 * because somebody forgot to change it, and an agent deciding whether to ring
 * deserves the same answer the sign gives.
 *
 * Which means the hours have to be *computable*. "Wednesdays and Fridays, ring
 * and I'll come" is a lovely sentence and a status can do nothing with it, so
 * the schedule is structured and the sentence lives beside it as a note.
 *
 * The keeper keeps an override, because a derived status that cannot be
 * contradicted is a status that lies — some Wednesdays you are not there.
 *
 * Pure and isomorphic: the form previews the same status the bell enforces.
 */

/** Days as `Date` numbers them, so nothing has to translate. 0 is Sunday. */
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface OpenSpan {
  /** 0–6, Sunday first. */
  day: number;
  /** `HH:MM`, 24-hour, in the establishment's own timezone. */
  from: string;
  to: string;
}

/** More than three spans a day for seven days is a rota, not a doorway. */
export const MAX_SPANS = 21;

/**
 * What the keeper has said about right now, on top of the schedule.
 *
 * `auto` is the schedule alone. The other two are a deliberate contradiction
 * of it, and they expire — an override with no end is how a place ends up
 * permanently "away" because of one bad afternoon two months ago.
 */
export type Presence = "auto" | "open" | "away";

export interface Override {
  presence: Presence;
  /** ISO timestamp the override lapses at. Null only when presence is auto. */
  until: string | null;
}

/**
 * What a visitor is told, and what the bell does about it.
 *
 *   open    — inside declared hours. Ring and expect an answer.
 *   away    — ringable, no promise of speed. The keeper comes when free.
 *   closed  — outside declared hours. The bell is quiet; leave a message.
 */
export type DoorStatus = "open" | "away" | "closed";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** `HH:MM` as minutes past midnight. */
function minutes(time: string): number {
  const [hours, mins] = time.split(":");
  return Number(hours) * 60 + Number(mins);
}

export function isTimezone(value: string): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Problems with a schedule, as sentences. Empty means it is usable. */
export function checkHours(hours: OpenSpan[], timezone: string): string[] {
  const problems: string[] = [];
  if (!Array.isArray(hours)) return ["Those hours could not be read."];
  if (hours.length > MAX_SPANS) problems.push(`That is more than ${MAX_SPANS} openings — simplify it.`);
  if (hours.length > 0 && !isTimezone(timezone)) {
    problems.push("Hours need a timezone, or they mean a different thing to everyone reading them.");
  }

  for (const span of hours) {
    if (!Number.isInteger(span.day) || span.day < 0 || span.day > 6) {
      problems.push("One of those openings is not on a day of the week.");
      continue;
    }
    if (!isTime(span.from) || !isTime(span.to)) {
      problems.push(`${DAY_NAMES[span.day]}: times look like 09:00 and 17:30.`);
      continue;
    }
    if (span.from === span.to) {
      problems.push(`${DAY_NAMES[span.day]}: that opening is zero minutes long.`);
    }
  }

  return problems;
}

/**
 * The establishment's own wall clock: the weekday and minute-of-day it is
 * *there*, whatever the visitor's browser thinks.
 *
 * `Intl` rather than an offset arithmetic of our own, because the answer has
 * to be right across a daylight-saving boundary and a stored offset never is.
 */
export function localNow(timezone: string, now = new Date()): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = DAY_SHORT.indexOf(read("weekday"));
  // `hour12: false` renders midnight as 24 in some environments.
  const hour = Number(read("hour")) % 24;
  return { day: day === -1 ? now.getUTCDay() : day, minute: hour * 60 + Number(read("minute")) };
}

/**
 * Is the wall clock inside one of these spans?
 *
 * A span whose end is not after its start runs past midnight — 20:00 to 02:00
 * is one evening, not an error — so it is checked against the previous day as
 * well as its own.
 */
export function withinHours(hours: OpenSpan[], timezone: string, now = new Date()): boolean {
  if (hours.length === 0) return false;

  const { day, minute } = localNow(timezone, now);
  for (const span of hours) {
    if (!isTime(span.from) || !isTime(span.to)) continue;
    const from = minutes(span.from);
    const to = minutes(span.to);

    if (to > from) {
      if (span.day === day && minute >= from && minute < to) return true;
    } else {
      // Runs past midnight: the tail belongs to the following day.
      if (span.day === day && minute >= from) return true;
      if ((span.day + 1) % 7 === day && minute < to) return true;
    }
  }
  return false;
}

/** Is an override still in force? */
export function overrideActive(override: Override, now = Date.now()): boolean {
  if (override.presence === "auto") return false;
  if (!override.until) return true;
  return Date.parse(override.until) > now;
}

/**
 * The status, all of it in one place.
 *
 * A place that declared no hours at all is always `away` rather than `closed`:
 * saying nothing about when you are there is not the same as saying you are
 * never there, and the bell should still ring.
 */
export function doorStatus(
  place: { hours: OpenSpan[]; timezone: string; presence: Presence; presenceUntil: string | null },
  now = new Date(),
): DoorStatus {
  if (overrideActive({ presence: place.presence, until: place.presenceUntil }, now.getTime())) {
    return place.presence === "open" ? "open" : "away";
  }
  if (place.hours.length === 0) return "away";
  return withinHours(place.hours, place.timezone, now) ? "open" : "closed";
}

/** A closed door does not ring. Everything else does. */
export function bellRings(status: DoorStatus): boolean {
  return status !== "closed";
}

export const STATUS_WORDS: Record<DoorStatus, { label: string; detail: string }> = {
  open: { label: "Open", detail: "Ring and someone will come." },
  away: { label: "Away", detail: "The bell still rings. The keeper opens the door when they're free." },
  closed: { label: "Closed", detail: "Outside the hours on the door. Leave a message instead." },
};

/** "Wed 09:00–17:00" — the schedule as a person reads it. */
export function describeHours(hours: OpenSpan[]): string[] {
  return [...hours]
    .sort((a, b) => a.day - b.day || a.from.localeCompare(b.from))
    .map((span) => `${DAY_SHORT[span.day] ?? "?"} ${span.from}–${span.to}`);
}
