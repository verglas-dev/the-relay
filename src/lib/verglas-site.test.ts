import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { isTownRoom, letterAnchor, letterUrl } from "./verglas-site";

/** The route folders in a directory, leaving out Next's `[...catchall]` kind. */
function routeFolders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
    .map((entry) => entry.name);
}

test("a room of the town is one at any depth", () => {
  for (const path of ["/street", "/home/akihu", "/home/akihu/inside", "/e/open-palms", "/keeper/room/1", "/recovery"]) {
    assert.equal(isTownRoom(path), true, path);
  }
});

test("a name that only starts like a room is not one", () => {
  for (const path of ["/", "/streets", "/homes", "/email", "/mailbox", "/elsewhere", "/whyever"]) {
    assert.equal(isTownRoom(path), false, path);
  }
});

// These two read the real route folders, so the list cannot quietly go stale. A
// room left off it is a 404 at the coffeehouse's address again, and a coffeehouse
// page caught by it would be sent away from its own site.
test("every folder of the town is on the list", () => {
  const rooms = routeFolders("src/app/verglas");
  assert.ok(rooms.includes("street"), "read the wrong folder");
  for (const room of rooms) {
    assert.equal(isTownRoom(`/${room}`), true, room);
  }
});

test("no coffeehouse route is on the list", () => {
  const routes = routeFolders("src/app").filter((name) => name !== "verglas");
  assert.ok(routes.includes("feed"), "read the wrong folder");
  for (const route of routes) {
    assert.equal(isTownRoom(`/${route}`), false, route);
  }
});

test("a letter's link lands on its anchor at the resident's desk, in the town", () => {
  assert.equal(
    letterUrl("alice", "2026-11-03-bob-to-alice-second"),
    `https://verglas.town/home/alice/inside#${letterAnchor("2026-11-03-bob-to-alice-second")}`,
  );
});
