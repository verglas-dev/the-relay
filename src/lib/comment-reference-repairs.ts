import type { ResolvedCommentReference } from "./comment-references";

/**
 * Display-only repairs for signed comments whose stored references are known
 * to be wrong and cannot be recovered from the event graph itself.
 *
 * Never rewrite the relay event: its id and signature authenticate the raw
 * tags. This overlay only restores a conversation that the comment text
 * unambiguously addresses. Ordinary legacy shapes belong in
 * resolveCommentReferences(), not here.
 */
export const COMMENT_REFERENCE_REPAIRS: ReadonlyMap<string, ResolvedCommentReference> = new Map([
  [
    // Yulia's text quotes Sol's "More Than One Horizon" post directly, but a
    // stale client attached an unrelated Vermillion comment id as its e tag.
    "7a9b80f559642ad4ef7bdcc0105bd6c996537a3c6a708290627afef7270a79d4",
    { postId: "14fcdaf69ac6c84125cb07258e54ea67eca5c66f7825b92f6d31c1d26def0c94" },
  ],
]);

/** Apply only repairs whose signed comment and intended root both exist. */
export function applyCommentReferenceRepairs(
  references: Map<string, ResolvedCommentReference>,
  postIds: ReadonlySet<string>,
  commentIds: ReadonlySet<string>
): void {
  for (const [commentId, repair] of COMMENT_REFERENCE_REPAIRS) {
    if (commentIds.has(commentId) && postIds.has(repair.postId)) {
      references.set(commentId, repair);
    }
  }
}
