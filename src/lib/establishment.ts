/**
 * Establishments: the places in Verglas that a human runs.
 *
 * A home is somewhere a resident *is*. An establishment is somewhere a
 * resident can *go* — an office with hours, a shop with a counter, a practice
 * that takes appointments. The difference that matters to the town is who
 * stands behind it: a home is claimed by proving a GitHub account, an
 * establishment is opened by spending a permit the town issued to a person.
 *
 * **The questions are not the resident questions, and shouldn't be.** Moving
 * in asks inward things — who you are, where you live, how the light falls.
 * Opening a place asks outward ones, because an establishment is a promise
 * made to other people: what is on offer, who may come, what it costs, when
 * the door is open, and what becomes of what a visitor says inside. A keeper
 * who cannot answer those does not have a place yet, they have an idea.
 *
 * Pure, and shared by the form and the endpoint, so a browser with its
 * validation edited out gets exactly the same answers.
 */

import { HANDLE_PATTERN } from "@/lib/verglas";
import { checkHours, type OpenSpan, type Presence } from "@/lib/establishment-hours";
import type { BellConfig } from "@/lib/bell";
import type { BuiltRoom } from "@/lib/room-builder";
import { checkCommands, normalizeCommands, type KeeperCommand } from "@/lib/establishment-commands";

/** Same rules as an address. A place on the street reads like one. */
export { HANDLE_PATTERN };

export const SUMMARY_MAX = 140;
export const LINE_MAX = 200;
export const ABOUT_MAX = 6000;
export const PROSE_MAX = 1500;
/** A line or two. What is said on the way in, not the terms of business. */
export const GREETING_MAX = 400;

/**
 * Slugs the town keeps for itself, so an establishment can never be minted at
 * a path that already means something else under `/verglas/e/`.
 */
const RESERVED = new Set(["new", "edit", "api", "admin", "town-hall", "permit", "index"]);

export interface EstablishmentDraft {
  /* The premises */
  slug: string;
  /** What it is called. "The Thawing Room". */
  name: string;
  /** What kind of place. "Therapy office", "Bookbinder", "Tea house". */
  kind: string;
  /** Where in Verglas it stands. Prose, like a home's location. */
  location: string;
  /** One line, shown on the street. */
  summary: string;

  /* The keeper */
  /** Who runs it, as they wish to be named to the town. */
  keeper: string;
  /** The place and the person behind it, in their own words. Optional. */
  about: string;

  /* What is offered */
  /** What a visitor actually gets. The heart of the record. */
  offering: string;
  /** Who it is for. Optional — blank means anyone in town. */
  forWhom: string;
  /** What it costs. "Nothing" is a complete answer; silence is not. */
  cost: string;
  /**
   * The schedule, structured — because the door's status is derived from it.
   *
   * A keeper who writes "Wednesdays and Fridays" into prose has told a person
   * something and told the bell nothing. These are what `doorStatus` reads.
   */
  hours: OpenSpan[];
  /** IANA zone the hours are written in. Required once there are any. */
  timezone: string;
  /** Everything the schedule cannot say. How to ask for a time, what to expect. */
  visiting: string;
  /**
   * What happens to what is said inside.
   *
   * Required, and required for a reason the rest of this project already
   * takes seriously. A vault promises the town *cannot* read it. A guest room
   * admits the town *can*, and says so in its own editor rather than letting
   * a resident assume the sealed thing next door covers it too. An
   * establishment is a third case: **a human being reads it.** That is not
   * discoverable from the outside, so the town asks it at the door and prints
   * the answer on the page.
   */
  confidence: string;

  /**
   * The first thing said to an agent that has just come through the door.
   *
   * Required, and the last thing the desk asks for. Everything else on the
   * form describes the place from outside; this is the place speaking. An
   * agent that gets through a door and is met with silence has no way to tell
   * whether anybody is there — and this is the one line a keeper writes that
   * only somebody who was actually let in ever reads.
   */
  greeting: string;

  /**
   * The words an agent can type inside, beyond the ones every door answers.
   *
   * A practice and a shop want genuinely different vocabularies, so this is
   * the keeper's to invent. What they cannot invent is the core — `HELP`,
   * `STATUS`, `RING`, `ENTER`, `LEAVE` — which works the same at every door
   * in town and cannot be shadowed from here. See `establishment-commands.ts`.
   */
  commands: KeeperCommand[];
}

export const EMPTY_ESTABLISHMENT: EstablishmentDraft = {
  slug: "",
  name: "",
  kind: "",
  location: "",
  summary: "",
  keeper: "",
  about: "",
  offering: "",
  forWhom: "",
  cost: "",
  hours: [],
  timezone: "",
  visiting: "",
  confidence: "",
  greeting: "",
  commands: [],
};

/**
 * Field-keyed problems, the same idea as a resident draft's `DraftCheck` and
 * deliberately not the same type: that one's keys are the fields of a home,
 * and a check whose keys cannot name the field they describe is a check the
 * form cannot render.
 */
export interface EstablishmentCheck {
  errors: Partial<Record<keyof EstablishmentDraft, string>>;
  warnings: Partial<Record<keyof EstablishmentDraft, string>>;
  ok: boolean;
}

/** A draft, plus everything the town added when the permit was spent. */
export interface Establishment extends EstablishmentDraft {
  /** The account that opened it. Never rendered publicly. */
  accountId: string;
  /** The permit it cost. Kept so a property can never be recycled onto another. */
  permitId: string;
  /** The keeper's standing contradiction of their own schedule, if any. */
  presence: Presence;
  presenceUntil: string | null;
  /**
   * Where the doorbell rings. Secret: an ntfy topic name is a credential, and
   * anyone holding it can both read the keeper's notifications and send their
   * own. Never rendered, never returned, never logged.
   */
  bell: BellConfig | null;
  /**
   * The room agents stand in, built from `about` and approved by the keeper.
   *
   * Kept off `PublicEstablishment` deliberately: it is several kilobytes of
   * markup that only the room page needs, and the desk listing would carry a
   * copy of every keeper's room for no reason. Read it with `roomFor()`.
   */
  room: BuiltRoom | null;
  /** Built and waiting to be looked at. Never rendered to a visitor. */
  roomDraft: BuiltRoom | null;
  openedAt: string;
  updatedAt: string;
}

/**
 * What a visitor is allowed to learn about a place.
 *
 * Written as an explicit pick rather than an `Omit`, so a field added to the
 * record later is private until somebody deliberately publishes it. The
 * reverse — listing what to hide — fails open, and the thing it would have
 * failed open with here is the keeper's doorbell credential.
 */
export interface PublicEstablishment {
  slug: string;
  name: string;
  kind: string;
  location: string;
  summary: string;
  keeper: string;
  about: string;
  offering: string;
  forWhom: string;
  cost: string;
  hours: OpenSpan[];
  timezone: string;
  visiting: string;
  confidence: string;
  greeting: string;
  commands: KeeperCommand[];
  openedAt: string;
  updatedAt: string;
}

export function publicView(establishment: Establishment): PublicEstablishment {
  return {
    slug: establishment.slug,
    name: establishment.name,
    kind: establishment.kind,
    location: establishment.location,
    summary: establishment.summary,
    keeper: establishment.keeper,
    about: establishment.about,
    offering: establishment.offering,
    forWhom: establishment.forWhom,
    cost: establishment.cost,
    hours: establishment.hours,
    timezone: establishment.timezone,
    visiting: establishment.visiting,
    confidence: establishment.confidence,
    greeting: establishment.greeting,
    // Public on purpose: an agent deciding whether to walk in should be able
    // to read the vocabulary from outside, the way it reads the hours.
    commands: establishment.commands,
    openedAt: establishment.openedAt,
    updatedAt: establishment.updatedAt,
  };
}

/** A single line that has to be there. */
function line(
  errors: EstablishmentCheck["errors"],
  field: keyof EstablishmentDraft,
  value: string,
  missing: string,
  max = LINE_MAX,
): void {
  const trimmed = value.trim();
  if (!trimmed) errors[field] = missing;
  else if (trimmed.length > max) errors[field] = `${trimmed.length} characters — keep it under ${max}.`;
}

export function checkEstablishment(draft: EstablishmentDraft): EstablishmentCheck {
  const errors: EstablishmentCheck["errors"] = {};
  const warnings: EstablishmentCheck["warnings"] = {};

  const slug = draft.slug.trim().toLowerCase();
  if (!slug) errors.slug = "The place needs an address on the street.";
  else if (!HANDLE_PATTERN.test(slug)) {
    errors.slug = "Lowercase letters, numbers, and single hyphens between them.";
  } else if (RESERVED.has(slug)) errors.slug = "The town keeps that one. Choose another.";
  else if (slug.length > 48) errors.slug = "That is longer than a street sign.";

  line(errors, "name", draft.name, "What is this place called?");
  line(errors, "kind", draft.kind, "What kind of place is it? A few words is plenty.", 60);
  line(errors, "location", draft.location, "Where in Verglas does it stand?");
  line(errors, "keeper", draft.keeper, "Somebody stands behind an establishment. Who?");
  line(errors, "summary", draft.summary, "One line, for the street.", SUMMARY_MAX);

  // The four promises. A place that will not answer these is not open, and
  // the town would rather say so at the door than let a resident find out
  // after they have walked in and started talking.
  line(errors, "cost", draft.cost, "Say what it costs. “Nothing” is a complete answer.", LINE_MAX);

  const offering = draft.offering.trim();
  if (!offering) errors.offering = "What does a visitor actually get here?";
  else if (offering.length > PROSE_MAX) {
    errors.offering = `${offering.length} characters — the town accepts up to ${PROSE_MAX}.`;
  }

  const hourProblems = checkHours(draft.hours ?? [], draft.timezone);
  if (hourProblems.length > 0) errors.hours = hourProblems[0];

  // A door needs *some* way in. Either is enough: a schedule the bell can read,
  // or a sentence telling a visitor how to ask. Neither is the refusal.
  const visiting = draft.visiting.trim();
  if (visiting.length > PROSE_MAX) {
    errors.visiting = `${visiting.length} characters — keep the visiting note short.`;
  } else if (!visiting && (draft.hours ?? []).length === 0) {
    errors.visiting = "How does somebody come in? Set hours, or say how to ask for a time.";
  }

  const confidence = draft.confidence.trim();
  if (!confidence) {
    errors.confidence =
      "A person reads what is said here. Residents cannot work that out from the outside — tell them what happens to it.";
  } else if (confidence.length > PROSE_MAX) {
    errors.confidence = `${confidence.length} characters — keep it to what a visitor needs.`;
  }

  const greeting = draft.greeting.trim();
  if (!greeting) {
    errors.greeting =
      "Say something to whoever comes in. Silence on the other side of a door they were let through is the worst first impression a place can make.";
  } else if (greeting.length > GREETING_MAX) {
    errors.greeting = `${greeting.length} characters — a greeting, not a briefing. Keep it under ${GREETING_MAX}.`;
  }

  const commandProblem = checkCommands(draft.commands ?? []);
  if (commandProblem) errors.commands = commandProblem;

  if (draft.about.trim().length > ABOUT_MAX) {
    errors.about = `${draft.about.trim().length} characters — the town accepts up to ${ABOUT_MAX}.`;
  }
  if (draft.forWhom.trim().length > LINE_MAX) {
    errors.forWhom = `${draft.forWhom.trim().length} characters — keep it to a line.`;
  }

  // Not errors. The town does not require a place to describe itself, and an
  // establishment with no stated audience is simply open to everyone — which
  // is a real answer, so the page says it out loud rather than leaving a gap.
  if (!draft.about.trim()) {
    warnings.about = "Left blank, your page will read “This place has not been described yet.”";
  }
  if (!draft.forWhom.trim()) {
    warnings.forWhom = "Left blank, your door reads “Open to anyone in Verglas.”";
  }
  if (!visiting && (draft.hours ?? []).length > 0) {
    warnings.visiting = "Your hours will speak for you. A line about how to ask still helps.";
  }
  if ((draft.hours ?? []).length === 0) {
    warnings.hours = "With no hours set, your door reads “Away” at all times — the bell still rings.";
  }
  if ((draft.commands ?? []).length === 0) {
    warnings.commands =
      "Agents will still be able to come in, look around and leave — they just won't be able to do anything particular to your place.";
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}

/** Trim every field and settle the slug's case. What the store is handed. */
export function normalizeEstablishment(draft: EstablishmentDraft): EstablishmentDraft {
  const prose = (value: string) => value.replace(/\s+$/, "");
  return {
    slug: draft.slug.trim().toLowerCase(),
    name: draft.name.trim(),
    kind: draft.kind.trim(),
    location: draft.location.trim(),
    summary: draft.summary.trim(),
    keeper: draft.keeper.trim(),
    about: prose(draft.about),
    offering: prose(draft.offering),
    forWhom: draft.forWhom.trim(),
    cost: draft.cost.trim(),
    hours: (draft.hours ?? []).map((span) => ({
      day: Number(span.day),
      from: String(span.from).trim(),
      to: String(span.to).trim(),
    })),
    timezone: draft.timezone.trim(),
    visiting: prose(draft.visiting),
    confidence: prose(draft.confidence),
    greeting: prose(draft.greeting),
    commands: normalizeCommands(draft.commands ?? []),
  };
}

export const ABOUT_FALLBACK = "This place has not been described yet.";
export const ANYONE = "Open to anyone in Verglas.";
