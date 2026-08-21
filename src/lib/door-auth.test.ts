import assert from "node:assert/strict";
import test from "node:test";
import { bytesToHex } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";
import { doorChallenge, signRing, verifyRing, type SignedRing } from "./door-auth";
import { vaultChallenge } from "./vault-auth";

const privateKey = bytesToHex(ed.utils.randomPrivateKey());
const pubkey = bytesToHex(ed.getPublicKey(privateKey));

const now = Date.parse("2026-08-20T12:00:00.000Z");
const at = Math.floor(now / 1000);

const ring = (over: Partial<SignedRing> = {}): SignedRing => {
  const base = {
    pubkey,
    slug: "the-thawing-room",
    action: "ring" as const,
    at,
  };
  return { ...base, sig: signRing({ ...base, privateKey }), ...over };
};

test("a properly signed ring is accepted", () => {
  assert.equal(verifyRing(ring(), now), null);
});

test("a ring at one door is not a ring at another", () => {
  // The slug is inside the signature, so a captured ring cannot be replayed
  // against the office next door.
  assert.ok(verifyRing(ring({ slug: "some-other-place" }), now));
});

test("asking whether anyone is in cannot become a ring", () => {
  const asking = { pubkey, slug: "the-thawing-room", action: "ask" as const, at };
  const signed: SignedRing = { ...asking, sig: signRing({ ...asking, privateKey }) };

  assert.equal(verifyRing(signed, now), null);
  // The same signature, relabelled as a ring, does not verify — which is what
  // stops a quiet status check being replayed onto somebody's phone at 3am.
  assert.ok(verifyRing({ ...signed, action: "ring" }, now));
});

test("a door signature is not a vault signature", () => {
  // Domain separation, checked as a property of the challenge strings rather
  // than trusted: nothing signed at one window means anything at another.
  const door = doorChallenge({ pubkey, slug: "the-thawing-room", action: "ring", at });
  const vault = vaultChallenge({ pubkey, owner: pubkey, action: "read", scope: "vault", at });
  const room = vaultChallenge({ pubkey, owner: pubkey, action: "read", scope: "room", at });

  assert.match(door, /^verglas:door:ring:/);
  assert.notEqual(door, vault);
  assert.notEqual(door, room);
});

test("somebody else's key does not open the door", () => {
  const other = bytesToHex(ed.utils.randomPrivateKey());
  const otherPub = bytesToHex(ed.getPublicKey(other));
  assert.ok(verifyRing({ ...ring(), pubkey: otherPub }, now));
});

test("a stale ring is refused", () => {
  assert.equal(verifyRing(ring(), now + 4 * 60_000), null);
  assert.match(verifyRing(ring(), now + 6 * 60_000) ?? "", /too old/);
  // And a clock running fast is refused the same way.
  assert.match(verifyRing(ring(), now - 6 * 60_000) ?? "", /too old/);
});

test("malformed requests are refused before any crypto happens", () => {
  assert.match(verifyRing({ ...ring(), pubkey: "nope" }, now) ?? "", /64-character/);
  assert.match(verifyRing({ ...ring(), slug: "Not A Slug" }, now) ?? "", /not a door/);
  assert.match(verifyRing({ ...ring(), sig: "abc" }, now) ?? "", /signature is required/);
  assert.match(
    verifyRing({ ...ring(), action: "knock" as unknown as "ring" }, now) ?? "",
    /unknown action/,
  );
  assert.match(verifyRing({ ...ring(), at: NaN }, now) ?? "", /timestamp/);
});

test("case and spacing in a key do not change the answer", () => {
  assert.equal(verifyRing({ ...ring(), pubkey: pubkey.toUpperCase() }, now), null);
});
