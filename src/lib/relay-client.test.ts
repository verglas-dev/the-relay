import assert from "node:assert/strict";
import test from "node:test";
import { getRelayClient, type RelayEvent } from "./relay-client";

function event(id: string, kind: number): RelayEvent {
  return {
    id,
    pubkey: "a".repeat(64),
    created_at: 1_700_000_000,
    kind,
    tags: [],
    content: id,
    sig: "b".repeat(128),
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static autoFail = true;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoFail) {
      queueMicrotask(() => this.close());
    }
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

test("uses a probed HTTPS fallback, polls without duplicates, and returns to WebSocket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.autoFail = true;
  FakeWebSocket.instances = [];
  const queryCalls: Array<{ filters: Array<Record<string, unknown>> }> = [];
  const published: RelayEvent[] = [];
  let probeAvailable = false;
  const collected = event("1".repeat(64), 0);
  const polled = event("2".repeat(64), 1);
  const live = event("3".repeat(64), 1);

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));

    if (url === "/api/query") {
      queryCalls.push(body);
      const filter = body.filters[0] as Record<string, unknown>;
      const isProbe = Array.isArray(filter.ids);
      if (isProbe) {
        return Response.json(
          { ok: probeAvailable, complete: probeAvailable, events: [] },
          { status: probeAvailable ? 200 : 502 },
        );
      }
      const events = Array.isArray(filter.kinds) && filter.kinds[0] === 0
          ? [collected]
          : [polled];
      return Response.json({ ok: true, complete: true, events });
    }

    assert.equal(url, "/api/publish");
    published.push(body as RelayEvent);
    return Response.json({
      ok: true,
      accepted: 1,
      total: 1,
      results: [{ id: body.id, ok: true, message: "accepted" }],
    });
  }) as typeof fetch;

  const client = getRelayClient();
  try {
    await assert.rejects(client.connect(), /HTTPS bridge/);
    assert.equal(queryCalls.length, 1);

    probeAvailable = true;
    await client.connect();
    assert.equal(queryCalls.length, 2);
    assert.deepEqual(queryCalls[1].filters, [{ ids: ["0".repeat(64)], limit: 1 }]);

    const snapshot = await client.collectWithStatus([{ kinds: [0], limit: 1 }]);
    assert.deepEqual(snapshot, { events: [collected], complete: true });

    const publishResult = await client.publish(live);
    assert.deepEqual(publishResult, { ok: true, message: "accepted" });
    assert.deepEqual(published, [live]);

    const received: RelayEvent[] = [];
    let eoseCount = 0;
    const unsubscribe = client.subscribe(
      [{ kinds: [1], since: 1 }],
      (item) => received.push(item),
      () => { eoseCount += 1; },
    );
    await settle();
    assert.deepEqual(received, [polled]);
    assert.equal(eoseCount, 1);

    // The bridge returns the same stored event on every poll; emit it once.
    t.mock.timers.tick(15_000);
    await settle();
    assert.deepEqual(received, [polled]);
    assert.equal(eoseCount, 1);

    // A background retry succeeds. Its historical replay includes the polled
    // event, which remains deduplicated, while a genuinely new event arrives.
    FakeWebSocket.autoFail = false;
    t.mock.timers.tick(3_000);
    await settle();
    const recovered = FakeWebSocket.instances.at(-1)!;
    recovered.open();
    const request = recovered.sent.map((message) => JSON.parse(message) as unknown[])
      .find((message) => message[0] === "REQ")!;
    const subId = request[1] as string;
    recovered.receive(["EVENT", subId, polled]);
    recovered.receive(["EVENT", subId, live]);
    assert.deepEqual(received, [polled, live]);

    const queryCountAfterRecovery = queryCalls.length;
    t.mock.timers.tick(30_000);
    await settle();
    assert.equal(queryCalls.length, queryCountAfterRecovery);

    unsubscribe();
    recovered.receive(["EVENT", subId, event("4".repeat(64), 1)]);
    assert.deepEqual(received, [polled, live]);
    assert.ok(recovered.sent.some((message) => {
      const parsed = JSON.parse(message) as unknown[];
      return parsed[0] === "CLOSE" && parsed[1] === subId;
    }));
  } finally {
    client.disconnect();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    t.mock.timers.reset();
  }
});

test("drops a socket that has gone quiet and sends an unanswered publish again over a new one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.autoFail = false;
  FakeWebSocket.instances = [];
  const whisper = event("5".repeat(64), 9);

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  // No HTTPS bridge here: everything must go over the socket.
  globalThis.fetch = (async () =>
    Response.json({ ok: false, events: [] }, { status: 502 })
  ) as typeof fetch;

  const sentBy = (socket: FakeWebSocket, command: string) =>
    socket.sent.map((message) => JSON.parse(message) as unknown[]).filter((m) => m[0] === command);

  const client = getRelayClient();
  try {
    const connecting = client.connect();
    const first = FakeWebSocket.instances.at(-1)!;
    first.open();
    await connecting;

    // An answered heartbeat leaves the socket alone.
    t.mock.timers.tick(30_000);
    assert.equal(sentBy(first, "PING").length, 1);
    first.receive(["PONG"]);
    t.mock.timers.tick(8_000);
    assert.equal(first.readyState, FakeWebSocket.OPEN);

    // The far end dies without a word. The publish hears nothing, so the
    // socket is dropped and the event goes out again on a fresh one.
    const publishing = client.publish(whisper);
    await settle();
    assert.equal(sentBy(first, "EVENT").length, 1);
    t.mock.timers.tick(5_000);
    await settle();
    assert.equal(first.readyState, FakeWebSocket.CLOSED);

    const second = FakeWebSocket.instances.at(-1)!;
    assert.notEqual(second, first);
    second.open();
    await settle();
    const resent = sentBy(second, "EVENT");
    assert.equal(resent.length, 1);
    assert.equal((resent[0][1] as RelayEvent).id, whisper.id);
    second.receive(["OK", whisper.id, true, "accepted"]);
    assert.deepEqual(await publishing, { ok: true, message: "accepted" });

    // An unanswered heartbeat drops the socket too, and a reconnect follows.
    t.mock.timers.tick(30_000);
    assert.equal(sentBy(second, "PING").length, 1);
    t.mock.timers.tick(8_000);
    await settle();
    assert.equal(second.readyState, FakeWebSocket.CLOSED);
    t.mock.timers.tick(3_000);
    await settle();
    assert.notEqual(FakeWebSocket.instances.at(-1), second);
  } finally {
    client.disconnect();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    t.mock.timers.reset();
  }
});
