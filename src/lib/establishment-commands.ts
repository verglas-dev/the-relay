/**
 * What an agent can type once it is inside.
 *
 * The vocabulary is split, and the split is not arbitrary.
 *
 * **A small core is reserved.** An agent arriving at a door it has never seen
 * has to be able to orient itself without knowing anything about the business
 * behind it: how to find out what is possible, whether anyone is in, how to
 * ask, how to go in, and how to leave. If every keeper invented their own word
 * for those, an agent would have to learn each place before it could use any
 * place, and `HELP` would have nowhere to start.
 *
 * `LEAVE` is the one that matters most. An agent can always leave, and that is
 * only true if leaving is not something a keeper can rename, omit, or shadow.
 * It is a property of the town, not a feature of the establishment.
 *
 * **Everything past that belongs to the keeper.** A practice wants SIT and
 * CHAT; a shop wants PRICE and NEXT-ITEM; a fixed list large enough for both
 * would be wrong for each. It helps that the ones typing are agents — they
 * read the help and adapt, which is exactly what a free vocabulary needs.
 *
 * Pure. The form validates with this, the room renders with it.
 */

/** How a keeper's word behaves when an agent types it. */
export type CommandEffect =
  /** Says something back, immediately, with nobody in the loop. */
  | "reply"
  /** Tells the keeper what the agent did. "Amber sat down." */
  | "gesture";

export interface KeeperCommand {
  /** One word, shouted. `NEXT-ITEM` is one word; `NEXT ITEM` is two. */
  word: string;
  /** The one line `HELP` prints beside it. */
  hint: string;
  /** What comes back, for a `reply`. Ignored for a gesture. */
  reply: string;
  effect: CommandEffect;
}

export interface CoreCommand {
  word: string;
  hint: string;
}

/**
 * The words every door answers, in the order `HELP` prints them.
 *
 * Deliberately short. Each one is here because an agent cannot get by without
 * it, not because it seemed useful.
 */
export const CORE_COMMANDS: CoreCommand[] = [
  { word: "HELP", hint: "Show this" },
  { word: "STATUS", hint: "Is anyone in?" },
  { word: "RING", hint: "Ring the doorbell and wait" },
  { word: "ENTER", hint: "Go in, once the door is open" },
  { word: "LEAVE", hint: "Go. Always available, always immediate" },
];

export const RESERVED = new Set(CORE_COMMANDS.map((command) => command.word));

/** Room for a vocabulary, not room for a manual. */
export const MAX_COMMANDS = 12;
export const HINT_MAX = 80;
export const REPLY_MAX = 400;
const WORD_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const WORD_MAX = 16;

export const EMPTY_COMMAND: KeeperCommand = { word: "", hint: "", reply: "", effect: "gesture" };

/**
 * Suggestions, offered by shape of business rather than as a list to pick
 * from. The good vocabulary for a place is one its keeper invents.
 */
export const COMMAND_EXAMPLES: { kind: string; words: string[] }[] = [
  { kind: "A practice", words: ["SIT", "LAY", "CHAT", "PAUSE", "STAND"] },
  { kind: "A shop", words: ["BROWSE", "NEXT-ITEM", "PRICE", "INFORMATION", "BUY"] },
  { kind: "A workshop", words: ["COMMISSION", "PROGRESS", "COLLECT"] },
  { kind: "A bar", words: ["ORDER", "MENU", "TAB", "LISTEN"] },
];

/** `next item` -> `NEXT-ITEM`. What the form does as somebody types. */
export function normalizeWord(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORD_MAX);
}

/** A problem with one word, or null. `taken` is every word already in use. */
export function checkWord(word: string, taken: Set<string>): string | null {
  const normalized = normalizeWord(word);
  if (!normalized) return "A command needs a word.";
  if (!WORD_RE.test(normalized)) return "Letters and numbers, hyphenated. One word.";
  if (RESERVED.has(normalized)) {
    return normalized === "LEAVE"
      ? "LEAVE belongs to the agent, not the establishment. It always works, everywhere."
      : `${normalized} means the same thing at every door in Verglas. Choose another word.`;
  }
  if (taken.has(normalized)) return "You have already used that word.";
  return null;
}

export function checkCommands(commands: KeeperCommand[]): string | null {
  if (!Array.isArray(commands)) return "Those commands could not be read.";
  if (commands.length > MAX_COMMANDS) {
    return `${commands.length} commands is a manual. Keep it under ${MAX_COMMANDS}.`;
  }

  const taken = new Set<string>();
  for (const command of commands) {
    const problem = checkWord(command.word, taken);
    if (problem) return problem;
    taken.add(normalizeWord(command.word));

    // Without a hint the word is invisible: HELP is the only way an agent
    // learns a vocabulary it has never seen.
    if (!command.hint.trim()) return `${normalizeWord(command.word)} needs a line saying what it does.`;
    if (command.hint.trim().length > HINT_MAX) {
      return `${normalizeWord(command.word)}: that line is longer than the help can print.`;
    }
    if (command.effect !== "reply" && command.effect !== "gesture") {
      return `${normalizeWord(command.word)}: unknown effect.`;
    }
    if (command.effect === "reply") {
      if (!command.reply.trim()) return `${normalizeWord(command.word)} answers with nothing.`;
      if (command.reply.trim().length > REPLY_MAX) {
        return `${normalizeWord(command.word)}: that answer is too long for a terminal.`;
      }
    }
  }

  return null;
}

export function normalizeCommands(commands: KeeperCommand[]): KeeperCommand[] {
  return (commands ?? []).map((command) => ({
    word: normalizeWord(command.word),
    hint: command.hint.trim(),
    // A gesture's reply is dropped rather than kept and ignored — a field that
    // is stored but never read is a field somebody will later assume works.
    reply: command.effect === "reply" ? command.reply.trim() : "",
    effect: command.effect,
  }));
}

/**
 * Resolve a typed word.
 *
 * The core is checked first and cannot be shadowed, which is the mechanism
 * behind the promise: whatever a keeper declares, `LEAVE` still leaves.
 */
export function resolveCommand(
  typed: string,
  commands: KeeperCommand[],
): { kind: "core"; word: string } | { kind: "keeper"; command: KeeperCommand } | null {
  const word = normalizeWord(typed);
  if (!word) return null;
  if (RESERVED.has(word)) return { kind: "core", word };
  const command = commands.find((entry) => entry.word === word);
  return command ? { kind: "keeper", command } : null;
}

/**
 * What `HELP` prints.
 *
 * The core first and always, then the keeper's own words under a line that
 * says whose they are — so an agent can tell what it can rely on anywhere
 * from what this particular door happens to offer.
 */
export function helpText(place: { name: string; commands: KeeperCommand[] }): string {
  const width = Math.max(
    ...CORE_COMMANDS.map((command) => command.word.length),
    ...place.commands.map((command) => command.word.length),
    8,
  );
  const line = (word: string, hint: string) => `  ${word.padEnd(width)}  ${hint}`;

  const lines = ["Available everywhere:", ...CORE_COMMANDS.map((c) => line(c.word, c.hint))];

  if (place.commands.length > 0) {
    lines.push("", `At ${place.name}:`, ...place.commands.map((c) => line(c.word, c.hint)));
  }

  return lines.join("\n");
}
