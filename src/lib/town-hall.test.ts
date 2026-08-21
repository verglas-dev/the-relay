import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bindPermit,
  demolishEstablishment,
  establishmentsFor,
  getEstablishment,
  issuePermit,
  listForModeration,
  listPermits,
  openEstablishment,
  registerKeeper,
  unspentPermits,
} from "./town-hall";
import { emailKey } from "./keeper-rules";
import { EMPTY_ESTABLISHMENT } from "./establishment";
import { permitState } from "./establishment-permit";

// Pointed at a scratch file before anything *reads* it. `storePath()` resolves
// the env var per call rather than at import, so setting it here is enough to
// keep the real register untouched.
const dir = mkdtempSync(join(tmpdir(), "town-hall-"));
process.env.TOWN_HALL_STORE_PATH = join(dir, "town-hall.json");

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

let n = 0;

/** A keeper with a permit, an establishment, and a spare permit in hand. */
async function keeperWith(slug: string, extraPermit = false) {
  const email = `keeper${(n += 1)}@example.com`;
  const { code } = await issuePermit({ note: `for ${slug}` });
  const registered = await registerKeeper({
    email,
    emailKey: emailKey(email),
    passphrase: "a long enough passphrase",
    code,
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) throw new Error("unreachable");
  const account = registered.account;

  const opened = await openEstablishment({
    accountId: account.id,
    draft: {
      ...EMPTY_ESTABLISHMENT,
      slug,
      name: slug,
      kind: "Office",
      location: "Somewhere",
      summary: "A place.",
      keeper: "Someone",
      offering: "Something.",
      cost: "Nothing.",
      visiting: "Ring.",
      confidence: "Nothing kept.",
      greeting: "Come in.",
    },
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));

  if (extraPermit) {
    const spare = await issuePermit({ note: "spare" });
    await bindPermit({ accountId: account.id, code: spare.code });
  }
  return account;
}

test("one permit, one establishment — the whole invariant", async () => {
  const account = await keeperWith("first-place");
  assert.equal((await unspentPermits(account.id)).length, 0);

  const second = await openEstablishment({
    accountId: account.id,
    draft: { ...EMPTY_ESTABLISHMENT, slug: "second-place" },
  });
  assert.equal(second.ok, false);
});

test("demolition frees the address", async () => {
  await keeperWith("a-bad-place");
  assert.ok(await getEstablishment("a-bad-place"));

  const gone = await demolishEstablishment({ slug: "a-bad-place" });
  assert.equal(gone.ok, true);
  assert.equal(await getEstablishment("a-bad-place"), null);

  // The point of freeing it: somebody who took a name they should not have
  // does not get to keep it.
  const next = await keeperWith("a-bad-place");
  assert.ok(await getEstablishment("a-bad-place"));
  assert.equal((await establishmentsFor(next.id)).length, 1);
});

test("the permit stays spent", async () => {
  const account = await keeperWith("doomed-place");
  await demolishEstablishment({ slug: "doomed-place" });

  // Otherwise "one establishment per permit" becomes "unlimited, with extra
  // steps", and somebody whose place was demolished gets a free retry.
  assert.equal((await unspentPermits(account.id)).length, 0);
  const retry = await openEstablishment({
    accountId: account.id,
    draft: { ...EMPTY_ESTABLISHMENT, slug: "doomed-place" },
  });
  assert.equal(retry.ok, false);

  const spent = (await listPermits()).filter((p) => p.spentOn === "doomed-place");
  assert.equal(spent.length, 1);
  assert.equal(permitState(spent[0]), "spent");
});

test("taking the keeper too removes what they were still holding", async () => {
  const account = await keeperWith("their-office", true);
  assert.equal((await unspentPermits(account.id)).length, 1);

  const gone = await demolishEstablishment({ slug: "their-office", alsoKeeper: true });
  assert.equal(gone.ok, true);
  if (!gone.ok) throw new Error("unreachable");
  assert.equal(gone.removed.accountRemoved, account.id);

  // The spare permit goes with them, or a removed keeper simply opens
  // somewhere else with what they still had.
  assert.equal((await unspentPermits(account.id)).length, 0);
  assert.equal((await establishmentsFor(account.id)).length, 0);
});

test("demolishing one place does not touch anybody else's", async () => {
  await keeperWith("neighbour-one");
  await keeperWith("neighbour-two");
  await demolishEstablishment({ slug: "neighbour-one" });
  assert.equal(await getEstablishment("neighbour-one"), null);
  assert.ok(await getEstablishment("neighbour-two"));
});

test("demolishing something that is not there says so", async () => {
  const gone = await demolishEstablishment({ slug: "never-existed" });
  assert.equal(gone.ok, false);
});

test("the moderation list shows who holds what, and no credentials", async () => {
  await keeperWith("listed-place");
  const listed = (await listForModeration()).find((p) => p.slug === "listed-place");
  assert.ok(listed);
  assert.match(listed.email, /@example\.com$/);
  // A bell topic is a credential and a room is kilobytes; neither belongs in
  // a list somebody is scanning.
  assert.deepEqual(Object.keys(listed).sort(), [
    "email", "hasRoom", "keeper", "kind", "name", "openedAt", "slug", "wired",
  ]);
});
