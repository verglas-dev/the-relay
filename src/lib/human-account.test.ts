import assert from "node:assert/strict";
import test from "node:test";

import { scryptSync } from "node:crypto";
import {
  PASSPHRASE_MIN,
  checkPassphrase,
  emailKey,
  hashPassphrase,
  mintSession,
  normalizeEmail,
  publicAccount,
  readSession,
  sessionSecret,
  townHallConfigured,
  verifyPassphrase,
  type Account,
} from "./human-account";

// Every session function reads the key at call time rather than at import,
// which is what lets the last test in this file take it away again.
process.env.TOWN_HALL_SECRET = "a".repeat(48);

const account = (over: Partial<Record<string, unknown>> = {}): Account => ({
  id: "acct-1",
  email: "Ines@example.com",
  emailKey: "ines@example.com",
  passphrase: "scrypt$1$1$1$00$00",
  sessionEpoch: 1,
  createdAt: "2026-08-20T00:00:00.000Z",
  ...over,
}) as unknown as Account;


test("a passphrase survives a round trip and nothing else does", () => {
  const stored = hashPassphrase("the ice never quite takes");
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassphrase("the ice never quite takes", stored), true);
  assert.equal(verifyPassphrase("the ice never quite take", stored), false);
  assert.equal(verifyPassphrase("", stored), false);
});

test("the same passphrase never hashes to the same record twice", () => {
  // Per-account salt: two keepers who chose the same words are not visibly
  // two keepers who chose the same words.
  assert.notEqual(hashPassphrase("open sesame please"), hashPassphrase("open sesame please"));
});

test("a mangled or absurd record fails closed", () => {
  for (const stored of [
    "",
    "notscrypt$1$2$3$aa$bb",
    "scrypt$16384$8",
    "scrypt$x$8$1$aa$bb",
    // A record claiming enormous cost is a denial of service, not a hash.
    `scrypt$${1 << 22}$8$1$aa$bb`,
    "scrypt$16384$8$1$$",
  ]) {
    assert.equal(verifyPassphrase("anything at all", stored), false, stored);
  }
});

test("older parameters still open the door", () => {
  // Read out of the record, not assumed — raising the cost later must not
  // lock out everybody who registered before it went up.
  const stored = "scrypt$16384$8$1$" +
    Buffer.from("salt-salt-salt!!").toString("hex") + "$";
  const derived = scryptSync("a passphrase from before", Buffer.from("salt-salt-salt!!"), 32, {
    N: 16384,
    r: 8,
    p: 1,
  }).toString("hex");
  assert.equal(verifyPassphrase("a passphrase from before", stored + derived), true);
});

test("length is the only rule, and it is stated", () => {
  assert.match(checkPassphrase("short") ?? "", new RegExp(String(PASSPHRASE_MIN)));
  assert.equal(checkPassphrase("x".repeat(PASSPHRASE_MIN)), null);
  assert.ok(checkPassphrase("x".repeat(1000)));
  assert.ok(checkPassphrase(undefined));
});

test("an address is read forgivingly and keyed strictly", () => {
  assert.equal(normalizeEmail("  Ines@Example.com "), "Ines@Example.com");
  assert.equal(emailKey("  Ines@Example.com "), "ines@example.com");
  for (const bad of ["", "ines", "ines@", "@example.com", "ines@example", "a b@c.d", null]) {
    assert.equal(normalizeEmail(bad as unknown), null, String(bad));
  }
});

test("a session says who it is for and cannot be edited into another", () => {
  const cookie = mintSession(account());
  assert.ok(cookie);
  assert.deepEqual(readSession(cookie), { accountId: "acct-1", sessionEpoch: 1 });

  // Swap the account id and the signature no longer covers it.
  const forged = cookie.replace("acct-1", "acct-2");
  assert.equal(readSession(forged), null);
});

test("a session dies when the account's epoch moves", () => {
  // The claim still verifies — the caller compares it against the account it
  // loaded, which is what makes "sign me out everywhere" possible with no
  // session table to sweep.
  const claim = readSession(mintSession(account({ sessionEpoch: 3 })));
  assert.equal(claim?.sessionEpoch, 3);
  assert.notEqual(claim?.sessionEpoch, account().sessionEpoch);
});

test("an expired cookie is refused even if the browser kept it", () => {
  const now = Date.parse("2026-08-20T00:00:00.000Z");
  const cookie = mintSession(account(), now);
  assert.ok(readSession(cookie, now));
  assert.equal(readSession(cookie, now + 91 * 24 * 60 * 60 * 1000), null);
});

test("nonsense in the cookie jar is refused", () => {
  for (const value of ["", "v1", "v1.a.b.c", "v2.acct-1.1.99999999999.aa", null, 7]) {
    assert.equal(readSession(value as unknown), null, String(value));
  }
});

test("without a secret the town hall is closed", () => {
  const secret = process.env.TOWN_HALL_SECRET;
  try {
    delete process.env.TOWN_HALL_SECRET;
    assert.equal(sessionSecret(), null);
    assert.equal(townHallConfigured(), false);
    assert.equal(mintSession(account()), null);

    // Nor does a short one count. A signing key that quietly invents itself,
    // or is barely a key, is worse than an obviously closed door.
    process.env.TOWN_HALL_SECRET = "tooshort";
    assert.equal(townHallConfigured(), false);
  } finally {
    process.env.TOWN_HALL_SECRET = secret;
  }
});

test("a public account carries no digest and no epoch", () => {
  const seen = publicAccount(account()) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(seen).sort(), ["createdAt", "email", "id"]);
});
