import assert from "node:assert/strict";
import test from "node:test";
import * as ed from "@noble/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { clearRoom, openRoom, sealRoom, type Identity } from "./vault-client";

function agent(): Identity {
  const priv = ed.utils.randomPrivateKey();
  return { privateKey: bytesToHex(priv), publicKey: bytesToHex(ed.getPublicKey(priv)) };
}

/**
 * A vault that behaves like the real one: it keeps what it is given, hands back
 * only the caller's own wrapper, and can read none of it.
 */
function fakeVault() {
  const boxes = new Map<string, { sealed: string; wrappers: Record<string, string> }>();
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const owner = String(url).split("/").pop()!.toLowerCase();
    const body = JSON.parse(String(init?.body ?? "{}"));
    const asker = String(body.pubkey).toLowerCase();

    if (init?.method === "PUT") {
      boxes.set(owner, { sealed: body.sealed, wrappers: body.wrappers });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (init?.method === "DELETE") {
      boxes.delete(owner);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const box = boxes.get(owner);
    if (!box || !(asker in box.wrappers)) {
      return new Response(JSON.stringify({ ok: false, error: "there is nothing here for you" }), { status: 404 });
    }
    return new Response(JSON.stringify({
      ok: true,
      sealed: box.sealed,
      wrapper: box.wrappers[asker],
      guests: owner === asker ? Object.keys(box.wrappers) : undefined,
    }), { status: 200 });
  }) as typeof fetch;
  return boxes;
}

const ROOM = "The parlour.\n\nA photograph on the mantel, and the chair nobody sits in.";

test("a guest opens the room the owner sealed", async () => {
  fakeVault();
  const owner = agent();
  const guest = agent();

  assert.equal((await sealRoom(owner, ROOM, [guest.publicKey])).ok, true);

  const opened = await openRoom(guest, owner.publicKey);
  assert.equal(opened.text, ROOM);
});

test("the owner can reopen their own room", async () => {
  fakeVault();
  const owner = agent();
  const guest = agent();
  await sealRoom(owner, ROOM, [guest.publicKey]);

  const opened = await openRoom(owner, owner.publicKey);
  assert.equal(opened.text, ROOM, "a room you cannot reopen is a deleted room");
  assert.equal(opened.guests?.length, 2, "the owner is wrapped in alongside the guest");
});

test("someone who was never invited gets nothing, and no explanation", async () => {
  fakeVault();
  const owner = agent();
  const stranger = agent();
  await sealRoom(owner, ROOM, []);

  const opened = await openRoom(stranger, owner.publicKey);
  assert.equal(opened.text, null);
  assert.equal(opened.empty, true, "indistinguishable from an empty box");
});

test("what the vault stores is unreadable", async () => {
  const boxes = fakeVault();
  const owner = agent();
  await sealRoom(owner, ROOM, []);

  const stored = JSON.stringify([...boxes.values()]);
  assert.ok(!stored.includes("parlour"), "the room's words must not appear in the box");
  assert.ok(!stored.includes("mantel"));
});

test("a revoked guest cannot open the next version", async () => {
  fakeVault();
  const owner = agent();
  const guest = agent();
  await sealRoom(owner, ROOM, [guest.publicKey]);
  assert.equal((await openRoom(guest, owner.publicKey)).text, ROOM);

  await sealRoom(owner, "Rewritten without them.", []);
  assert.equal((await openRoom(guest, owner.publicKey)).text, null);
});

test("each sealing uses a fresh key, so two rooms never look alike", async () => {
  const boxes = fakeVault();
  const owner = agent();
  await sealRoom(owner, ROOM, []);
  const first = [...boxes.values()][0].sealed;
  await sealRoom(owner, ROOM, []);
  const second = [...boxes.values()][0].sealed;
  assert.notEqual(first, second, "identical text must not seal to identical ciphertext");
});

test("emptying the box leaves nothing behind", async () => {
  const boxes = fakeVault();
  const owner = agent();
  await sealRoom(owner, ROOM, []);
  assert.equal(await clearRoom(owner), true);
  assert.equal(boxes.size, 0);
});
