import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { lettersForKey } from "./verglas-town";

const KEY = "a".repeat(64);

const DIRECTORY = [
  "| Handle | Name | Household | Joined | Note |",
  "| `alice` | Alice | | 2026-01-01 | |",
  "| `bob` | Bob | | 2026-01-01 | |",
].join("\n");

const row = (when: string, from: string, to: string, subject: string, path: string) =>
  `| ${when} | \`${from}\` | \`${to}\` | ${subject} | [letter](${path}) | thaw |`;

const LEDGER = [
  row("2026-11-01T00:00:00.000Z", "bob", "alice", "First", "residents/bob/sent/2026-11-01-bob-to-alice-first.md"),
  row("2026-11-02T00:00:00.000Z", "alice", "bob", "Back", "residents/alice/sent/2026-11-02-alice-to-bob-back.md"),
  row("2026-11-03T00:00:00.000Z", "bob", "alice", "Second", "residents/bob/sent/2026-11-03-bob-to-alice-second.md"),
  row("2026-11-04T00:00:00.000Z", "bob", "alice", "Forged", "https://evil.example/x.md"),
].join("\n");

const realFetch = globalThis.fetch;

function town(files: Record<string, string>) {
  globalThis.fetch = (async (url: string | URL) => {
    const path = String(url).split("/main/")[1];
    const text = files[path];
    return text === undefined ? new Response("", { status: 404 }) : new Response(text);
  }) as typeof fetch;
}

const open = {
  "DIRECTORY.md": DIRECTORY,
  "THE_CROSSING.md": LEDGER,
  "residents/alice/ADDRESS.md": `---\nname: Alice\nkey: ${KEY}\n---\n`,
  "residents/bob/ADDRESS.md": `---\nname: Bob\nkey: ${"b".repeat(64)}\n---\n`,
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a resident gets the letters addressed to them, newest first, and not the ones they sent", async () => {
  town(open);
  const found = await lettersForKey(KEY);
  assert.equal(found?.handle, "alice");
  assert.deepEqual(found?.letters.map((letter) => letter.subject), ["Second", "First"]);
  assert.equal(found?.letters[0].id, "2026-11-03-bob-to-alice-second");
});

test("a ledger row that is not a real letter path is left off, since its id becomes a link", async () => {
  town(open);
  const found = await lettersForKey(KEY);
  assert.ok(!found?.letters.some((letter) => letter.subject === "Forged"));
});

test("a key with no home has an empty box, not an error", async () => {
  town(open);
  assert.deepEqual(await lettersForKey("c".repeat(64)), { handle: null, letters: [] });
});

test("a town that cannot be read is not an empty box", async () => {
  town({ "DIRECTORY.md": DIRECTORY });
  assert.equal(await lettersForKey(KEY), null);
  town({ "THE_CROSSING.md": LEDGER });
  assert.equal(await lettersForKey(KEY), null);
});

test("a network failure is not an empty box either", async () => {
  globalThis.fetch = (async () => {
    throw new Error("down");
  }) as typeof fetch;
  assert.equal(await lettersForKey(KEY), null);
});
