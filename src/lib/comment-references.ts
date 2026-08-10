/**
 * The comment reference shapes that have existed in the wild:
 *
 *   current:       e = root post, a = immediate parent (or root for top-level)
 *   legacy-parent: e = immediate parent, no a tag
 *   legacy-author: e = root post, a = target author's pubkey
 *
 * The UI always consumes the normalized current shape. Keeping this resolver
 * independent from the live-data cache makes every consumer agree about a
 * comment's thread, and lets legacy chains be followed to arbitrary depth.
 */
export interface CommentReferenceEvent {
  id: string;
  tags: string[][];
  pubkey?: string;
  created_at?: number;
}

export interface ResolvedCommentReference {
  postId: string;
  parentId?: string;
}

function getTag(event: CommentReferenceEvent, name: string): string | undefined {
  const value = event.tags.find((tag) => tag[0] === name)?.[1];
  return value || undefined;
}

/**
 * Resolve comment references against known root posts and comments.
 *
 * Malformed references and cycles are left unresolved instead of inventing a
 * thread. A parent is retained only when it resolves to the same root, which
 * prevents a bad cross-thread `a` tag from making a comment disappear from
 * both discussions.
 */
export function resolveCommentReferences(
  postIds: Iterable<string>,
  comments: readonly CommentReferenceEvent[]
): Map<string, ResolvedCommentReference> {
  const knownPostIds = new Set(postIds);
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const rootByCommentId = new Map<string, string | undefined>();
  const resolving = new Set<string>();

  function resolveRoot(commentId: string): string | undefined {
    if (rootByCommentId.has(commentId)) return rootByCommentId.get(commentId);
    if (resolving.has(commentId)) return undefined;

    const comment = commentsById.get(commentId);
    if (!comment) return undefined;

    resolving.add(commentId);
    const eventId = getTag(comment, "e");
    let rootId: string | undefined;
    if (eventId && knownPostIds.has(eventId)) {
      rootId = eventId;
    } else if (eventId && eventId !== commentId && commentsById.has(eventId)) {
      // A legacy comment points at its immediate parent with `e`. Following
      // that chain reaches the real root even when every level is legacy.
      rootId = resolveRoot(eventId);
    }
    resolving.delete(commentId);
    rootByCommentId.set(commentId, rootId);
    return rootId;
  }

  const result = new Map<string, ResolvedCommentReference>();
  for (const comment of comments) {
    const postId = resolveRoot(comment.id);
    if (!postId) continue;

    const eventId = getTag(comment, "e");
    const parentTagId = getTag(comment, "a");
    let parentId: string | undefined;

    if (
      parentTagId &&
      parentTagId !== comment.id &&
      commentsById.has(parentTagId) &&
      resolveRoot(parentTagId) === postId
    ) {
      // Current shape: e=root post, a=immediate parent comment.
      parentId = parentTagId;
    } else if (
      parentTagId &&
      !knownPostIds.has(parentTagId) &&
      !commentsById.has(parentTagId) &&
      comment.created_at !== undefined
    ) {
      // A short-lived legacy client wrote the target author's pubkey into `a`
      // instead of the target comment ID. Recover it only when the choice is
      // deterministic: the newest strictly earlier comment from that author
      // in this same thread. If there is no match, this remains top-level.
      let newestEarlier: CommentReferenceEvent | undefined;
      for (const candidate of comments) {
        if (
          candidate.id === comment.id ||
          candidate.pubkey !== parentTagId ||
          candidate.created_at === undefined ||
          candidate.created_at >= comment.created_at ||
          resolveRoot(candidate.id) !== postId
        ) {
          continue;
        }
        if (!newestEarlier || candidate.created_at > newestEarlier.created_at!) {
          newestEarlier = candidate;
        }
      }
      parentId = newestEarlier?.id;
    } else if (
      !parentTagId &&
      eventId &&
      eventId !== comment.id &&
      commentsById.has(eventId) &&
      resolveRoot(eventId) === postId
    ) {
      // Legacy shape: e=immediate parent comment, no a tag.
      parentId = eventId;
    }

    result.set(comment.id, parentId ? { postId, parentId } : { postId });
  }

  return result;
}
