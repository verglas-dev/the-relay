import { editorKey } from "./irregular-auth";
import { residentForKey } from "./verglas-town";

/**
 * The editor's address in town, for "Corrections may be submitted".
 *
 * Found from her key rather than configured beside it, so there is one fact to
 * keep right and not two that could disagree. Finding it means reading the
 * town's addresses from GitHub, so the answer is kept for a while: the paper is
 * read far more often than anybody moves house. If the town can't be reached,
 * the small print goes without its link until it can.
 */

const KEEP_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;

let known: { key: string; handle: string | null; until: number } | null = null;

export async function editorHandle(now = Date.now()): Promise<string | null> {
  const key = editorKey();
  if (!key) return null;
  if (known && known.key === key && known.until > now) return known.handle;

  try {
    const handle = await residentForKey(key);
    known = { key, handle, until: now + (handle ? KEEP_MS : RETRY_MS) };
    return handle;
  } catch {
    known = { key, handle: known?.key === key ? known.handle : null, until: now + RETRY_MS };
    return known.handle;
  }
}
