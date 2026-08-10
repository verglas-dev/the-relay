/**
 * Tracks relay events already represented by the current browser session.
 * Persistent relay subscriptions replay matching stored events on reconnect,
 * so invalidating only for a newly observed ID prevents refresh storms while
 * still catching events published by another client.
 */
export class LiveEventTracker {
  private readonly seenIds = new Set<string>();

  markKnown(ids: Iterable<string>): void {
    for (const id of ids) this.seenIds.add(id);
  }

  observe(id: string): boolean {
    if (this.seenIds.has(id)) return false;
    this.seenIds.add(id);
    return true;
  }
}
