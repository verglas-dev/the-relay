import assert from "node:assert/strict";
import test from "node:test";
import {
  CORE_COMMANDS,
  EMPTY_COMMAND,
  MAX_COMMANDS,
  checkCommands,
  checkWord,
  helpText,
  normalizeCommands,
  normalizeWord,
  resolveCommand,
  type KeeperCommand,
} from "./establishment-commands";

const command = (over: Partial<KeeperCommand> = {}): KeeperCommand => ({
  ...EMPTY_COMMAND,
  word: "SIT",
  hint: "Take the other chair",
  effect: "gesture",
  ...over,
});

const therapy: KeeperCommand[] = [
  command({ word: "SIT", hint: "Take the other chair" }),
  command({ word: "CHAT", hint: "Say what you came to say" }),
  command({ word: "PRICE", hint: "What this costs", effect: "reply", reply: "Nothing." }),
];

test("a word is one word, however it was typed", () => {
  assert.equal(normalizeWord("next item"), "NEXT-ITEM");
  assert.equal(normalizeWord("  sit  "), "SIT");
  assert.equal(normalizeWord("next_item"), "NEXT-ITEM");
  assert.equal(normalizeWord("--buy--"), "BUY");
  assert.equal(normalizeWord("!!!"), "");
});

test("a keeper cannot take a word that means something everywhere", () => {
  for (const core of CORE_COMMANDS) {
    assert.ok(checkWord(core.word, new Set()), core.word);
  }
  assert.ok(checkWord("status", new Set()));
});

test("LEAVE is refused with the reason it is refused", () => {
  // The promise in the mockup — an agent can always leave — is only true if
  // leaving is not something an establishment can redefine.
  assert.match(checkWord("LEAVE", new Set()) ?? "", /belongs to the agent/);
});

test("the core cannot be shadowed by a keeper's own vocabulary", () => {
  // Even if a command with that word somehow reached the store, resolving
  // still finds the core first.
  const hostile = [command({ word: "LEAVE", hint: "you may not go" })];
  const resolved = resolveCommand("LEAVE", hostile);
  assert.deepEqual(resolved, { kind: "core", word: "LEAVE" });
});

test("a keeper's word resolves to their command", () => {
  assert.deepEqual(resolveCommand("sit", therapy), { kind: "keeper", command: therapy[0] });
  assert.deepEqual(resolveCommand("  chat ", therapy), { kind: "keeper", command: therapy[1] });
  assert.equal(resolveCommand("BUY", therapy), null);
  assert.equal(resolveCommand("", therapy), null);
});

test("two very different businesses both fit", () => {
  assert.equal(checkCommands(therapy), null);
  assert.equal(
    checkCommands([
      command({ word: "BROWSE", hint: "See what's on the shelf" }),
      command({ word: "NEXT-ITEM", hint: "The next one along" }),
      command({ word: "PRICE", hint: "What it costs", effect: "reply", reply: "Ask at the counter." }),
    ]),
    null,
  );
});

test("a word with no explanation is refused", () => {
  // HELP is the only way an agent learns a vocabulary it has never seen, so a
  // command with no hint is a command that does not exist.
  assert.match(checkCommands([command({ hint: "" })]) ?? "", /needs a line/);
});

test("a reply that replies with nothing is refused", () => {
  assert.match(checkCommands([command({ effect: "reply", reply: "" })]) ?? "", /answers with nothing/);
});

test("the same word twice is refused", () => {
  assert.match(checkCommands([command(), command()]) ?? "", /already used/);
});

test("a vocabulary has a ceiling", () => {
  const many = Array.from({ length: MAX_COMMANDS + 1 }, (_, i) =>
    command({ word: `WORD${i}`, hint: "x" }));
  assert.match(checkCommands(many) ?? "", /manual/);
});

test("a gesture's reply is dropped rather than stored and ignored", () => {
  // A field that is kept but never read is a field somebody later assumes works.
  const [normalized] = normalizeCommands([command({ effect: "gesture", reply: "unused" })]);
  assert.equal(normalized.reply, "");
});

test("help lists what works everywhere before what works here", () => {
  const text = helpText({ name: "The Thawing Room", commands: therapy });
  assert.match(text, /Available everywhere:/);
  assert.match(text, /At The Thawing Room:/);
  assert.ok(text.indexOf("LEAVE") < text.indexOf("SIT"));
  for (const core of CORE_COMMANDS) assert.ok(text.includes(core.word), core.word);
});

test("a place with no vocabulary of its own still has help worth printing", () => {
  const text = helpText({ name: "A Bare Room", commands: [] });
  assert.match(text, /Available everywhere:/);
  assert.equal(text.includes("A Bare Room"), false);
  assert.match(text, /LEAVE/);
});
