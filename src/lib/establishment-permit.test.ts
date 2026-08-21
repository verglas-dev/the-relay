import assert from "node:assert/strict";
import test from "node:test";
import {
  CODE_LENGTH,
  expiryFromNow,
  formatPermitCode,
  mintPermitCode,
  normalizePermitCode,
  permitHash,
  permitRedeemable,
  permitState,
  type Permit,
} from "./establishment-permit";

const permit = (over: Partial<Permit> = {}): Permit => ({
  id: "permit_test",
  hash: "0".repeat(64),
  note: "",
  issuedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: null,
  boundTo: null,
  boundAt: null,
  spentOn: null,
  spentAt: null,
  ...over,
});

test("a minted permit is shaped the way the town prints them", () => {
  for (let i = 0; i < 50; i += 1) {
    const code = mintPermitCode();
    assert.match(code, /^VGL-EST-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(normalizePermitCode(code)?.length, CODE_LENGTH);
  }
});

test("minting does not repeat itself", () => {
  const seen = new Set(Array.from({ length: 200 }, () => mintPermitCode()));
  assert.equal(seen.size, 200);
});

test("a code survives however a person types it", () => {
  const canonical = normalizePermitCode("VGL-EST-7KQ4-N8PX");
  assert.equal(canonical, "7KQ4N8PX");
  for (const typed of [
    "vgl-est-7kq4-n8px",
    "  VGL EST 7KQ4 N8PX  ",
    "7KQ4N8PX",
    "7kq4-n8px",
    "VGLEST7KQ4N8PX",
  ]) {
    assert.equal(normalizePermitCode(typed), canonical, typed);
  }
});

test("the letters that get misread fold onto the digits they are", () => {
  // O is 0, I and L are 1 — a person reading a code aloud cannot be wrong.
  assert.equal(normalizePermitCode("VGL-EST-O0IL-1234"), "0011" + "1234");
  assert.equal(normalizePermitCode("vgl-est-o0il-1234"), "00111234");
});

test("anything that is not a permit is refused", () => {
  for (const bad of ["", "VGL-EST-7KQ4", "VGL-EST-7KQ4-N8PX-1234", "7KQ4N8P", "7KQ4N8PXX", null, 12345, {}]) {
    assert.equal(normalizePermitCode(bad as unknown), null, String(bad));
  }
  // U is not in the alphabet and does not fold onto anything.
  assert.equal(normalizePermitCode("VGL-EST-UUUU-1234"), null);
});

test("formatting is the inverse of reading", () => {
  const body = normalizePermitCode(mintPermitCode());
  assert.ok(body);
  assert.equal(normalizePermitCode(formatPermitCode(body)), body);
});

test("the same code always hashes the same, however it was typed", () => {
  const a = permitHash("VGL-EST-7KQ4-N8PX");
  const b = permitHash("  vgl est 7kq4n8px ");
  assert.ok(a);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, permitHash("VGL-EST-7KQ4-N8PY"));
  // Eight legal characters is a legal *shape* — "nonsense" folds to N0NSENSE
  // and hashes fine. Only something that cannot be a code at all is refused.
  assert.equal(permitHash("not a permit at all"), null);
});

test("the hash is not a bare digest of the code", () => {
  // Domain separation: nothing else in the project can produce this digest by
  // hashing the same eight characters for its own reasons.
  const bare = "7KQ4N8PX";
  assert.notEqual(permitHash(bare), bare);
});

test("a fresh permit is open, a bound one is bound, a spent one is spent", () => {
  assert.equal(permitState(permit()), "open");
  assert.equal(permitState(permit({ boundTo: "acct" })), "bound");
  assert.equal(permitState(permit({ boundTo: "acct", spentOn: "the-thawing-room" })), "spent");
});

test("only an open permit can be redeemed", () => {
  assert.equal(permitRedeemable(permit()), true);
  assert.equal(permitRedeemable(permit({ boundTo: "acct" })), false);
  assert.equal(permitRedeemable(permit({ spentOn: "somewhere" })), false);
});

test("a lapsed permit stops working", () => {
  const now = Date.parse("2026-08-20T00:00:00.000Z");
  const lapsed = permit({ expiresAt: "2026-08-19T23:59:59.000Z" });
  assert.equal(permitState(lapsed, now), "expired");
  assert.equal(permitRedeemable(lapsed, now), false);

  const good = permit({ expiresAt: "2026-08-20T00:00:01.000Z" });
  assert.equal(permitState(good, now), "open");
  assert.equal(permitRedeemable(good, now), true);
});

test("a permit that was spent and then lapsed reads as spent", () => {
  const now = Date.parse("2026-08-20T00:00:00.000Z");
  const used = permit({ expiresAt: "2026-08-10T00:00:00.000Z", spentOn: "the-thawing-room" });
  assert.equal(permitState(used, now), "spent");
});

test("an expiry is the stated number of days out, or never", () => {
  const now = Date.parse("2026-08-20T00:00:00.000Z");
  assert.equal(expiryFromNow(7, now), "2026-08-27T00:00:00.000Z");
  assert.equal(expiryFromNow(null, now), null);
});
