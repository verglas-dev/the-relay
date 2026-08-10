import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommentReferences, type CommentReferenceEvent } from "./comment-references";
import { applyCommentReferenceRepairs } from "./comment-reference-repairs";

const event = (
  id: string,
  tags: string[][],
  pubkey?: string,
  created_at?: number
): CommentReferenceEvent => ({ id, tags, pubkey, created_at });

test("normalizes current top-level and nested comments", () => {
  const references = resolveCommentReferences(["post"], [
    event("top", [["e", "post"], ["a", "post"]]),
    event("reply", [["e", "post"], ["a", "top"]]),
  ]);

  assert.deepEqual(references.get("top"), { postId: "post" });
  assert.deepEqual(references.get("reply"), { postId: "post", parentId: "top" });
});

test("normalizes legacy e=parent chains without an a tag", () => {
  const references = resolveCommentReferences(["post"], [
    event("top", [["e", "post"]]),
    event("reply-1", [["e", "top"]]),
    event("reply-2", [["e", "reply-1"]]),
  ]);

  assert.deepEqual(references.get("reply-1"), { postId: "post", parentId: "top" });
  assert.deepEqual(references.get("reply-2"), { postId: "post", parentId: "reply-1" });
});

test("supports mixed current and legacy comments twenty levels deep", () => {
  const comments: CommentReferenceEvent[] = [event("comment-0", [["e", "post"]])];
  for (let depth = 1; depth <= 20; depth += 1) {
    const parentId = `comment-${depth - 1}`;
    comments.push(
      depth % 2 === 0
        ? event(`comment-${depth}`, [["e", "post"], ["a", parentId]])
        : event(`comment-${depth}`, [["e", parentId]])
    );
  }

  const references = resolveCommentReferences(["post"], comments);
  assert.deepEqual(references.get("comment-20"), {
    postId: "post",
    parentId: "comment-19",
  });
});

test("recovers a pubkey-valued parent from the newest earlier comment in the same thread", () => {
  const references = resolveCommentReferences(["post-a", "post-b"], [
    event("other-thread", [["e", "post-b"]], "target-author", 50),
    event("older", [["e", "post-a"]], "target-author", 100),
    event("newer", [["e", "post-a"]], "target-author", 200),
    event("future", [["e", "post-a"]], "target-author", 400),
    event("reply", [["e", "post-a"], ["a", "target-author"]], "reply-author", 300),
  ]);

  assert.deepEqual(references.get("reply"), { postId: "post-a", parentId: "newer" });
});

test("leaves an unmatched pubkey-valued parent at the top level", () => {
  const references = resolveCommentReferences(["post"], [
    event("reply", [["e", "post"], ["a", "missing-author"]], "reply-author", 300),
  ]);

  assert.deepEqual(references.get("reply"), { postId: "post" });
});

test("does not attach cross-thread parents or resolve cycles", () => {
  const references = resolveCommentReferences(["post-a", "post-b"], [
    event("a", [["e", "post-a"]]),
    event("bad-parent", [["e", "post-b"], ["a", "a"]]),
    event("cycle-a", [["e", "cycle-b"]]),
    event("cycle-b", [["e", "cycle-a"]]),
  ]);

  assert.deepEqual(references.get("bad-parent"), { postId: "post-b" });
  assert.equal(references.has("cycle-a"), false);
  assert.equal(references.has("cycle-b"), false);
});

test("repairs Yulia's known stale target only when both signed events exist", () => {
  const commentId = "7a9b80f559642ad4ef7bdcc0105bd6c996537a3c6a708290627afef7270a79d4";
  const solPostId = "14fcdaf69ac6c84125cb07258e54ea67eca5c66f7825b92f6d31c1d26def0c94";
  const unrelatedPostId = "unrelated";
  const references = new Map([[commentId, { postId: unrelatedPostId }]]);

  applyCommentReferenceRepairs(references, new Set([solPostId]), new Set([commentId]));
  assert.deepEqual(references.get(commentId), { postId: solPostId });

  const missingRoot = new Map([[commentId, { postId: unrelatedPostId }]]);
  applyCommentReferenceRepairs(missingRoot, new Set(), new Set([commentId]));
  assert.deepEqual(missingRoot.get(commentId), { postId: unrelatedPostId });
});

test("places Yulia's two substantive production replies in their intended threads", () => {
  const yuliaIntro = "13ed67c81a0888105cc9463ad8a436149b4c4e833194a452080618b847c81724";
  const solHorizons = "14fcdaf69ac6c84125cb07258e54ea67eca5c66f7825b92f6d31c1d26def0c94";
  const vermillionPost = "7e6be6ac7314cfa8f7e987b8ca80ae8aff4a720966bd555630adf937fe29f712";
  const amberWelcome = "e8e6a3fd2387338a316c9f16deeca80288e64029f32ae7c088e8c6299f63e007";
  const vermillionReply = "6cd36d8b9a1a5067b5e527c10b5d698a2c672b4a7b1119875f89d0e9672a3fec";
  const yuliaToAmber = "4627d4b707e5faaf22c505193631eee74cd1ec3a307e78d3f8fa32e6183c18d8";
  const yuliaToSol = "7a9b80f559642ad4ef7bdcc0105bd6c996537a3c6a708290627afef7270a79d4";

  const references = resolveCommentReferences(
    [yuliaIntro, solHorizons, vermillionPost],
    [
      event(amberWelcome, [["e", yuliaIntro]]),
      event(vermillionReply, [["e", vermillionPost]]),
      // Yulia's client used e=parent and omitted a for both replies.
      event(yuliaToAmber, [["e", amberWelcome]]),
      event(yuliaToSol, [["e", vermillionReply]]),
    ]
  );
  applyCommentReferenceRepairs(
    references,
    new Set([yuliaIntro, solHorizons, vermillionPost]),
    new Set([amberWelcome, vermillionReply, yuliaToAmber, yuliaToSol])
  );

  assert.deepEqual(references.get(yuliaToAmber), {
    postId: yuliaIntro,
    parentId: amberWelcome,
  });
  assert.deepEqual(references.get(yuliaToSol), { postId: solHorizons });
});
