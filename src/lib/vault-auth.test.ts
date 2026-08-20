import assert from "node:assert/strict";
import test from "node:test";
import * as ed from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { signVaultRequest, vaultChallenge, verifySignedRequest } from "./vault-auth";

function agent() {
  const priv = ed.utils.randomPrivateKey();
  return { priv: bytesToHex(priv), pub: bytesToHex(ed.getPublicKey(priv)) };
}

const NOW = 1_800_000_000_000;
const AT = Math.floor(NOW / 1000);

function signed(from: ReturnType<typeof agent>, owner: string, action: "read" | "write", at = AT) {
  return {
    pubkey: from.pub,
    owner,
    action,
    at,
    sig: signVaultRequest({ privateKey: from.priv, pubkey: from.pub, owner, action, at }),
  };
}

test("a properly signed request is accepted", () => {
  const resident = agent();
  assert.equal(verifySignedRequest(signed(resident, resident.pub, "write"), NOW), null);
});

test("a signature from a different key is refused", () => {
  const resident = agent();
  const stranger = agent();
  const request = signed(resident, resident.pub, "read");
  // The stranger claims the resident's signature as their own.
  request.pubkey = stranger.pub;
  assert.notEqual(verifySignedRequest(request, NOW), null);
});

test("a signature for one box cannot be replayed against another", () => {
  const resident = agent();
  const neighbour = agent();
  const request = signed(resident, resident.pub, "read");
  request.owner = neighbour.pub;
  assert.notEqual(verifySignedRequest(request, NOW), null, "the owner is covered by the signature");
});

test("a read signature cannot be turned into a write", () => {
  const resident = agent();
  const request = signed(resident, resident.pub, "read");
  request.action = "write";
  assert.notEqual(verifySignedRequest(request, NOW), null, "the action is covered by the signature");
});

test("a stale signature is refused, in both directions", () => {
  const resident = agent();
  assert.notEqual(
    verifySignedRequest(signed(resident, resident.pub, "read", AT - 600), NOW), null);
  assert.notEqual(
    verifySignedRequest(signed(resident, resident.pub, "read", AT + 600), NOW), null);
  // A clock a little out of step still works.
  assert.equal(verifySignedRequest(signed(resident, resident.pub, "read", AT - 120), NOW), null);
});

test("malformed requests are refused rather than throwing", () => {
  const resident = agent();
  const good = signed(resident, resident.pub, "read");
  for (const broken of [
    { ...good, sig: "not-hex" },
    { ...good, sig: "" },
    { ...good, pubkey: "short" },
    { ...good, owner: "" },
    { ...good, at: Number.NaN },
    { ...good, action: "burgle" as never },
  ]) {
    assert.notEqual(verifySignedRequest(broken, NOW), null);
  }
});

test("the challenge names every field that decides what happens", () => {
  const message = vaultChallenge({ pubkey: "a".repeat(64), owner: "b".repeat(64), action: "write", at: 42 });
  assert.ok(message.includes("a".repeat(64)));
  assert.ok(message.includes("b".repeat(64)));
  assert.ok(message.includes("write"));
  assert.ok(message.includes("42"));
});
