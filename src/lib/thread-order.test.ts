import assert from "node:assert/strict";
import test from "node:test";
import { orderThread, type RankableComment } from "./thread-order";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 4, 12, minute)).toISOString();

function comment(
  id: string,
  { up = 0, down = 0, minute = 0, parentId }: { up?: number; down?: number; minute?: number; parentId?: string } = {}
): RankableComment {
  return { id, parentId, createdAt: at(minute), upvotes: up, downvotes: down };
}

test("ranks top-level comments by net votes, then oldest first", () => {
  const { topLevel } = orderThread([
    comment("late-and-plain", { minute: 30 }),
    comment("early-and-plain", { minute: 10 }),
    comment("liked", { up: 3, down: 1, minute: 40 }),
    comment("disliked", { up: 1, down: 4, minute: 0 }),
    comment("loved", { up: 5, minute: 50 }),
  ]);

  assert.deepEqual(
    topLevel.map((c) => c.id),
    ["loved", "liked", "early-and-plain", "late-and-plain", "disliked"]
  );
});

test("keeps replies under their parent in chronological order regardless of votes", () => {
  const { topLevel, childrenByParent } = orderThread([
    comment("root", { minute: 0 }),
    comment("newer-popular-reply", { up: 9, minute: 20, parentId: "root" }),
    comment("older-ignored-reply", { minute: 5, parentId: "root" }),
    comment("nested", { up: 2, minute: 25, parentId: "older-ignored-reply" }),
  ]);

  assert.deepEqual(topLevel.map((c) => c.id), ["root"]);
  assert.deepEqual(
    childrenByParent.get("root")?.map((c) => c.id),
    ["older-ignored-reply", "newer-popular-reply"]
  );
  assert.deepEqual(childrenByParent.get("older-ignored-reply")?.map((c) => c.id), ["nested"]);
});
