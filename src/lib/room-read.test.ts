import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listAdminComments } from "./admin-comment-store";
import { listAdminPosts } from "./admin-post-store";
import { listAdminProfiles } from "./admin-store";
import { createRoomReader, type RoomRead } from "./room-read";

function reading(fetchedAt: number): RoomRead {
  return {
    room: { posts: [], commentsByPost: new Map(), postIdByCommentId: new Map(), agents: new Map() },
    newPosts: [],
    full: false,
    oldest: Infinity,
    fetchedAt,
  };
}

function setup(answer: (call: number) => RoomRead | null | Promise<RoomRead | null>) {
  const state = { now: 1_000_000, calls: 0 };
  const reader = createRoomReader(
    async () => answer(++state.calls),
    () => state.now,
  );
  return { state, reader };
}

test("callers within half a minute share one read, and the next one reads again", async () => {
  const { state, reader } = setup(() => reading(state.now));
  const first = await reader.current();
  state.now += 29_000;
  assert.equal(await reader.current(), first);
  assert.equal(state.calls, 1);

  state.now += 2_000;
  assert.notEqual(await reader.current(), first);
  assert.equal(state.calls, 2);
});

test("callers who arrive during a read wait for that read", async () => {
  let finish = (_: RoomRead) => {};
  const { state, reader } = setup(() => new Promise<RoomRead>((resolve) => { finish = resolve; }));
  const waiting = [reader.current(), reader.current(), reader.forPage()];
  await Promise.resolve();
  finish(reading(state.now));
  const [a, b, c] = await Promise.all(waiting);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(state.calls, 1);
});

test("a failed read serves the last copy for a while, then nothing", async () => {
  const { state, reader } = setup((call) => (call === 1 ? reading(state.now) : null));
  const first = await reader.current();

  // Past the half minute the read fails, and the old copy still stands in.
  state.now += 60_000;
  assert.equal(await reader.current(), first);

  // Moderation has to keep applying, so five minutes is as far as that goes.
  state.now += 5 * 60_000;
  assert.equal(await reader.current(), null);
});

test("a failing relay is not asked again on every request", async () => {
  const { state, reader } = setup(() => null);
  assert.equal(await reader.current(), null);
  assert.equal(await reader.current(), null);
  assert.equal(state.calls, 1);

  state.now += 6_000;
  assert.equal(await reader.current(), null);
  assert.equal(state.calls, 2);
});

test("a read that throws is an empty answer, not a failed page", async () => {
  const { reader } = setup(() => {
    throw new Error("the moderation store is unreadable");
  });
  assert.equal(await reader.current(), null);
  assert.equal(await reader.forPage(), null);
});

test("a page does not wait for a slow relay, and the read still lands for the next one", async () => {
  let finish = (_: RoomRead) => {};
  const { state, reader } = setup(() => new Promise<RoomRead>((resolve) => { finish = resolve; }));

  assert.equal(await reader.forPage(5), null);

  const landed = reading(state.now);
  finish(landed);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await reader.forPage(5), landed);
  assert.equal(state.calls, 1);
});

test("a page that cannot wait gets the last copy if there is one", async () => {
  let finish = (_: RoomRead) => {};
  const { state, reader } = setup((call) =>
    call === 1 ? reading(state.now) : new Promise<RoomRead>((resolve) => { finish = resolve; }),
  );
  const first = await reader.current();

  state.now += 60_000;
  assert.equal(await reader.forPage(5), first);
  finish(reading(state.now));
});

test("a moderation store that cannot be parsed is an error for those who ask, and only them", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "room-read-"));
  const stores = [
    ["ADMIN_POST_STORE_PATH", listAdminPosts],
    ["ADMIN_PROFILE_STORE_PATH", listAdminProfiles],
    ["ADMIN_COMMENT_STORE_PATH", listAdminComments],
  ] as const;
  t.after(async () => {
    for (const [name] of stores) delete process.env[name];
    await fs.rm(dir, { recursive: true, force: true });
  });

  for (const [name, list] of stores) {
    const file = path.join(dir, `${name}.json`);
    await fs.writeFile(file, "{ half a write");
    process.env[name] = file;

    assert.deepEqual(await list({ includeDeleted: true }), [], `${name} stays lenient for the admin pages`);
    await assert.rejects(list({ includeDeleted: true, strict: true }), SyntaxError, `${name} is strict on request`);
  }
});
