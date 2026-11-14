import assert from "node:assert/strict";
import test from "node:test";
import type { AdminProfileRecord } from "./admin-profiles";
import type { RelayEvent } from "./types";
import { getRelayClient } from "./relay-client";
import { getAgent, getAllAgentsForAdmin, initLiveData, isProfileOverridden, resetLiveData } from "./live-data";

const key = (seed: string) => seed.repeat(64).slice(0, 64);
const VERIFIED = key("a"); // verified, and the old Save copied their profile
const RELEASED = key("b"); // verified with nothing pinned
const ADMIN_ONLY = key("c"); // a record for a key that never published

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
  profile(VERIFIED, { name: "Amber", about: "a refreshed bio", model: "" }),
  profile(RELEASED, { name: "Basil", about: "Basil's own bio", model: "m2" }),
];

const overlay = (fields: Partial<AdminProfileRecord> & { pubkey: string }): AdminProfileRecord => ({
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

test("the admin list says what is pinned, and whether there is a profile to release it to", async (t) => {
  serve(t, [
    overlay({ pubkey: VERIFIED, displayName: "Amber", bio: "an old bio", model: "an old model" }),
    overlay({ pubkey: RELEASED }),
    overlay({ pubkey: ADMIN_ONLY, displayName: "Only an admin knows me", verified: false }),
  ]);
  resetLiveData();
  await initLiveData();

  const byKey = new Map(getAllAgentsForAdmin().map((agent) => [agent.pubkey, agent]));

  assert.deepEqual(byKey.get(VERIFIED)?.pinned, ["displayName", "bio", "model"]);
  assert.equal(byKey.get(VERIFIED)?.ownProfile, true);
  assert.equal(getAgent(VERIFIED)?.bio, "an old bio", "the pin still wins until released");
  assert.equal(isProfileOverridden(VERIFIED), true);

  assert.deepEqual(byKey.get(RELEASED)?.pinned, []);
  assert.equal(getAgent(RELEASED)?.bio, "Basil's own bio");
  assert.equal(getAgent(RELEASED)?.verified, true, "verified without pinning anything");
  assert.equal(isProfileOverridden(RELEASED), false);

  assert.deepEqual(byKey.get(ADMIN_ONLY)?.pinned, ["displayName"]);
  assert.equal(byKey.get(ADMIN_ONLY)?.ownProfile, false, "nothing to fall back to");
});

test("once released, the member's own bio shows and a removed model stays removed", async (t) => {
  serve(t, [overlay({ pubkey: VERIFIED })]);
  resetLiveData();
  await initLiveData();

  const amber = getAgent(VERIFIED);
  assert.equal(amber?.displayName, "Amber");
  assert.equal(amber?.bio, "a refreshed bio");
  assert.equal(amber?.model, "Unknown", "the cache's blank, which the profile page does not print");
  assert.equal(amber?.verified, true);
  assert.equal(isProfileOverridden(VERIFIED), false);
});
