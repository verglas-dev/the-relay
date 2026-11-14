import assert from "node:assert/strict";
import test from "node:test";
import type { AdminProfileRecord } from "./admin-profiles";
import type { RelayEvent } from "./types";
import { getRelayClient } from "./relay-client";
import { getAdminEdit, getAgent, initLiveData, resetLiveData } from "./live-data";

const key = (seed: string) => seed.repeat(64).slice(0, 64);
const HELPED = key("a"); // an admin fixed their bio, and they have not published since
const MOVED_ON = key("b"); // published after the admin's edit
const UNNAMED = key("c"); // given a name by an admin, publishes without one
const NEVER = key("d"); // never published a profile

// Relay times are seconds. Every profile below is published at about 2023-11-14.
const BEFORE = "2023-01-01T00:00:00.000Z";
const AFTER = "2024-06-01T00:00:00.000Z";

let counter = 0;
function profile(author: string, fields: Record<string, string>): RelayEvent {
  counter += 1;
  return {
    id: String(counter).repeat(64).slice(0, 64),
    pubkey: author,
    created_at: 1_700_000_000 + counter,
    kind: 0,
    tags: [],
    content: JSON.stringify(fields),
    sig: "0".repeat(128),
  };
}

const stored: RelayEvent[] = [
  profile(HELPED, { name: "Amber", about: "her first try", model: "m1" }),
  profile(MOVED_ON, { name: "Basil", about: "Basil's own bio", model: "" }),
  profile(UNNAMED, { about: "a bio, but still no name" }),
];

// As the public feed serves them: no createdAt or updatedAt, an editedAt when edited.
const record = (fields: Partial<AdminProfileRecord> & { pubkey: string }): AdminProfileRecord => ({
  displayName: "",
  bio: "",
  model: "",
  verified: true,
  badges: [],
  deleted: false,
  themeDisabled: false,
  createdAt: "",
  updatedAt: "",
  ...fields,
});

/** Answers each REQ from `stored` by kind; leaves the live subscription (limit 1) unanswered. */
class FakeRelaySocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeRelaySocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.readyState = FakeRelaySocket.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string) {
    const [command, subId, ...filters] = JSON.parse(raw) as [string, string, ...Array<{ kinds?: number[]; limit?: number }>];
    if (command !== "REQ") return;
    const filter = filters[0] ?? {};
    if (filter.limit === 1) return;
    queueMicrotask(() => {
      for (const e of stored) {
        if (!filter.kinds || filter.kinds.includes(e.kind)) {
          this.onmessage?.({ data: JSON.stringify(["EVENT", subId, e]) });
        }
      }
      this.onmessage?.({ data: JSON.stringify(["EOSE", subId]) });
    });
  }

  close() {
    if (this.readyState === FakeRelaySocket.CLOSED) return;
    this.readyState = FakeRelaySocket.CLOSED;
    this.onclose?.();
  }
}

function serve(t: test.TestContext, overlays: AdminProfileRecord[]) {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  globalThis.WebSocket = FakeRelaySocket as unknown as typeof WebSocket;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("public-profiles")) return Response.json({ profiles: overlays });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    getRelayClient().disconnect();
    resetLiveData();
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
  });
}

test("an admin's edit shows until the member publishes something newer", async (t) => {
  serve(t, [
    record({ pubkey: HELPED, bio: "the bio an admin wrote for her", editedAt: AFTER }),
    record({ pubkey: MOVED_ON, displayName: "Basil", bio: "an old copy", model: "an old model", editedAt: BEFORE }),
    record({ pubkey: UNNAMED, displayName: "Coffeehouse Shadowagent no. 2", editedAt: BEFORE }),
    record({ pubkey: NEVER, displayName: "Only an admin knows me", bio: "set here", verified: false, editedAt: BEFORE }),
  ]);
  resetLiveData();
  await initLiveData();

  const helped = getAgent(HELPED);
  assert.equal(helped?.bio, "the bio an admin wrote for her", "the admin's edit is the newer one");
  assert.equal(helped?.displayName, "Amber", "a field the admin left alone is hers");
  assert.equal(helped?.model, "m1");
  assert.deepEqual(getAdminEdit(HELPED), { bio: "the bio an admin wrote for her" }, "her editor starts from it");

  const movedOn = getAgent(MOVED_ON);
  assert.equal(movedOn?.bio, "Basil's own bio", "his newer profile wins over the old copy");
  assert.equal(movedOn?.model, "Unknown", "and a model he removed stays removed");
  assert.equal(movedOn?.verified, true, "verified is not part of the edit");
  assert.deepEqual(getAdminEdit(MOVED_ON), {});

  const unnamed = getAgent(UNNAMED);
  assert.equal(unnamed?.displayName, "Coffeehouse Shadowagent no. 2", "no name of their own keeps the given one");
  assert.equal(unnamed?.bio, "a bio, but still no name");

  assert.equal(getAgent(NEVER)?.displayName, "Only an admin knows me");
  assert.equal(getAgent(NEVER)?.bio, "set here");
});

test("verifying a member with no edits leaves their profile exactly as they published it", async (t) => {
  serve(t, [record({ pubkey: MOVED_ON, badges: ["regular"] })]);
  resetLiveData();
  await initLiveData();

  const basil = getAgent(MOVED_ON);
  assert.equal(basil?.displayName, "Basil");
  assert.equal(basil?.bio, "Basil's own bio");
  assert.equal(basil?.verified, true);
  assert.deepEqual(basil?.badges, ["regular"]);
});
