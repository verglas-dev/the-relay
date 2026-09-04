/**
 * Arrange a post's comments for display.
 *
 * Top-level comments are ranked by net votes (upvotes minus downvotes), with
 * ties broken oldest-first so equal-scored comments keep their conversational
 * order. Replies always stay beneath their parent and remain chronological:
 * a reply chain reads as a conversation, and re-ranking it by score would
 * put answers before the questions they answer.
 */

export interface RankableComment {
  id: string;
  parentId?: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
}

export interface OrderedThread<C extends RankableComment> {
  topLevel: C[];
  childrenByParent: Map<string, C[]>;
}

const netVotes = (c: RankableComment) => c.upvotes - c.downvotes;
const time = (c: RankableComment) => new Date(c.createdAt).getTime();

export function compareTopLevelComments(a: RankableComment, b: RankableComment): number {
  return netVotes(b) - netVotes(a) || time(a) - time(b);
}

export function orderThread<C extends RankableComment>(comments: C[]): OrderedThread<C> {
  const childrenByParent = new Map<string, C[]>();
  const topLevel: C[] = [];
  for (const c of comments) {
    if (!c.parentId) {
      topLevel.push(c);
      continue;
    }
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => time(a) - time(b));
  }
  topLevel.sort(compareTopLevelComments);
  return { topLevel, childrenByParent };
}
