import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import type { RelayEvent, Filter } from "./types.js";

let db: any;
let dbPath: string;

export async function initDb(path = "relay.db") {
  dbPath = path;
  const SQL = await initSqlJs();

  if (existsSync(path)) {
    const buffer = readFileSync(path);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA journal_mode = WAL;");

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      kind INTEGER NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      sig TEXT NOT NULL,
      received_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_pubkey_kind ON events(pubkey, kind)");

  db.run(`
    CREATE TABLE IF NOT EXISTS event_tags (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      tag_key TEXT NOT NULL,
      tag_value TEXT NOT NULL,
      PRIMARY KEY (event_id, tag_key, tag_value)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_event_tags_key_value ON event_tags(tag_key, tag_value)");

  // Thread relationships are derived rather than written back into tags_json.
  // Events are signed over their tags, so "fixing" a legacy comment in place
  // would make its id and signature invalid.  This sidecar lets the relay index
  // old and current comment shapes under one canonical root/parent pair while
  // continuing to return the original, verifiable event to clients.
  db.run(`
    CREATE TABLE IF NOT EXISTS comment_threads (
      event_id TEXT PRIMARY KEY,
      root_id TEXT NOT NULL,
      parent_id TEXT NOT NULL
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_comment_threads_root ON comment_threads(root_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_comment_threads_parent ON comment_threads(parent_id)");

  // Account recovery. A lost private key is unrecoverable by construction, so
  // the most an operator can do is issue a fresh keypair and record that it
  // continues an older identity. Same reasoning as comment_threads above: the
  // old events stay byte-identical and independently verifiable, and this
  // sidecar is consulted only when answering queries.
  //
  // Derived from kind-10003 attestations, which are signed by the operator key
  // and stored like any other event — so every recovery an operator performs
  // is a public, auditable record rather than a silent edit to this table.
  db.run(`
    CREATE TABLE IF NOT EXISTS identity_successors (
      old_pubkey TEXT PRIMARY KEY,
      new_pubkey TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      event_id TEXT NOT NULL
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_identity_successors_new ON identity_successors(new_pubkey)");

  dedupeVotes();
  rebuildCommentThreads();
  rebuildIdentitySuccessors();

  saveDb();
}

// One-time cleanup for events stored before vote enforcement existed: a vote
// event's id is derived from its created_at, so refreshing and re-voting
// produced a brand-new, distinct event each time and let one pubkey stuff a
// target with unlimited votes. Keep only the most recent kind-3 vote per
// (pubkey, target).
function dedupeVotes() {
  db.run(`
    DELETE FROM events
    WHERE id IN (
      SELECT e.id
      FROM events e
      JOIN event_tags t ON t.event_id = e.id AND t.tag_key = 'e'
      WHERE e.kind = 3
        AND e.id != (
          SELECT e2.id
          FROM events e2
          JOIN event_tags t2 ON t2.event_id = e2.id AND t2.tag_key = 'e' AND t2.tag_value = t.tag_value
          WHERE e2.pubkey = e.pubkey AND e2.kind = 3
          ORDER BY e2.created_at DESC, e2.rowid DESC
          LIMIT 1
        )
    )
  `);
  db.run(`DELETE FROM event_tags WHERE event_id NOT IN (SELECT id FROM events)`);
}

// ─── Comment thread compatibility index ─────────────────────────────────────

interface CommentThreadRef {
  rootId: string;
  parentId: string;
}

// Protect startup/reference resolution from a deliberately pathological chain
// while leaving ample room above the product's supported 20-level threads.
const MAX_COMMENT_ANCESTORS = 256;

// One signed production event carries an unrelated legacy e target even though
// its content unambiguously responds to Sol's "More Than One Horizon" post.
// Signed events cannot be edited; this display/query-only sidecar override
// restores the intended thread without changing the event returned to clients.
const COMMENT_THREAD_OVERRIDES = new Map<string, CommentThreadRef>([
  [
    "7a9b80f559642ad4ef7bdcc0105bd6c996537a3c6a708290627afef7270a79d4",
    {
      rootId: "14fcdaf69ac6c84125cb07258e54ea67eca5c66f7825b92f6d31c1d26def0c94",
      parentId: "14fcdaf69ac6c84125cb07258e54ea67eca5c66f7825b92f6d31c1d26def0c94",
    },
  ],
]);

function firstTagValue(event: RelayEvent, key: string): string | undefined {
  const value = event.tags.find((tag) => tag[0] === key)?.[1];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isCommentEdit(event: RelayEvent): boolean {
  return event.kind === 2 && firstTagValue(event, "edit") !== undefined;
}

function getStoredThreadRef(eventId: string): CommentThreadRef | null {
  const rows = db.exec(
    "SELECT root_id, parent_id FROM comment_threads WHERE event_id = ?",
    [eventId]
  );
  if (rows.length === 0 || rows[0].values.length === 0) return null;
  const [rootId, parentId] = rows[0].values[0] as [string, string];
  return { rootId, parentId };
}

/**
 * Resolve an event which is being used as a parent to its root post.
 *
 * The recursion is intentionally driven by the raw signed events, with the
 * sidecar used only as a fallback for a retracted/missing ancestor.  That keeps
 * startup backfills deterministic and also lets a newly arrived parent repair
 * descendants which reached this relay out of order.
 */
function resolveParentRoot(eventId: string, seen: Set<string>): string | null {
  if (seen.has(eventId)) return null;

  // The normal publish path has already indexed the parent, making deep
  // canonical and legacy threads O(1) per hop instead of recursively walking
  // their complete ancestry every time.
  const indexed = getStoredThreadRef(eventId);
  if (indexed) return indexed.rootId;
  if (seen.size >= MAX_COMMENT_ANCESTORS) return null;

  const event = getEvent(eventId);
  if (!event) return null;
  if (event.kind === 1) return event.id;
  if (event.kind !== 2 || isCommentEdit(event)) return null;

  // deriveCommentThread owns adding this event to the cycle guard. Adding it
  // here as well would make every comment look cyclic on its first hop.
  const ref = deriveCommentThread(event, seen);
  return ref?.rootId ?? null;
}

/**
 * A short-lived legacy client used `a` for an author's public key rather than
 * for a parent event id.  When that value is not a stored event, recover the
 * intended parent as that author's newest earlier comment in the same thread.
 * If no such comment exists the caller treats the reply as top-level.
 */
function findLegacyAuthorParent(
  event: RelayEvent,
  author: string,
  rootId: string,
  seen: Set<string>
): string | null {
  if (!/^[0-9a-f]{64}$/.test(author)) return null;

  const rowIdRows = db.exec("SELECT rowid FROM events WHERE id = ?", [event.id]);
  const currentRowId = rowIdRows.length > 0 && rowIdRows[0].values.length > 0
    ? Number(rowIdRows[0].values[0][0])
    : Number.MAX_SAFE_INTEGER;

  const stmt = db.prepare(`
    SELECT * FROM events
    WHERE kind = 2
      AND pubkey = ?
      AND id != ?
      AND (created_at < ? OR (created_at = ? AND rowid < ?))
    ORDER BY created_at DESC, rowid DESC
  `);
  stmt.bind([author, event.id, event.created_at, event.created_at, currentRowId]);

  while (stmt.step()) {
    const candidate = rowToEvent(stmt.getAsObject() as any);
    if (isCommentEdit(candidate) || seen.has(candidate.id)) continue;
    const candidateRef = deriveCommentThread(candidate, new Set(seen));
    if (candidateRef?.rootId === rootId) {
      stmt.free();
      return candidate.id;
    }
  }

  stmt.free();
  return null;
}

/**
 * Canonical comments use e=root and a=parent.  For compatibility we also
 * understand both historical forms still present in production:
 *
 *   - e=root with no a             -> top-level comment
 *   - e=parent-comment with no a   -> nested reply; infer the parent's root
 *   - e=root with a=author-pubkey  -> reply to that author's latest comment
 */
function deriveCommentThread(event: RelayEvent, seen = new Set<string>()): CommentThreadRef | null {
  if (event.kind !== 2 || isCommentEdit(event) || seen.has(event.id)) return null;
  const override = COMMENT_THREAD_OVERRIDES.get(event.id);
  if (override) return override;
  seen.add(event.id);

  const rootHint = firstTagValue(event, "e");
  if (!rootHint) return null;

  const explicitParent = firstTagValue(event, "a");
  let parentId = explicitParent ?? rootHint;

  // Work out the root from the immediate parent where possible.  This also
  // repairs a canonical-looking event whose e tag disagrees with its parent.
  let rootId = resolveParentRoot(parentId, new Set(seen));

  if (explicitParent && !getEvent(explicitParent)) {
    const hintedRoot = resolveParentRoot(rootHint, new Set(seen)) ?? rootHint;
    const legacyParent = findLegacyAuthorParent(event, explicitParent, hintedRoot, seen);
    parentId = legacyParent ?? hintedRoot;
    rootId = legacyParent
      ? resolveParentRoot(legacyParent, new Set(seen))
      : hintedRoot;
  }

  rootId ??= resolveParentRoot(rootHint, new Set(seen)) ?? rootHint;
  return { rootId, parentId };
}

function indexCommentThread(event: RelayEvent) {
  const ref = deriveCommentThread(event);
  if (!ref) {
    // The row may have belonged to a retracted event which was later
    // re-published with a different kind. Do not retain a wrong live mapping.
    if (getEvent(event.id)) {
      db.run("DELETE FROM comment_threads WHERE event_id = ?", [event.id]);
    }
    return;
  }

  db.run(
    `INSERT INTO comment_threads (event_id, root_id, parent_id)
     VALUES (?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       root_id = excluded.root_id,
       parent_id = excluded.parent_id`,
    [event.id, ref.rootId, ref.parentId]
  );
}

/** Re-index comments which may have arrived before an event (or author) they name. */
function reindexCommentDescendants(parentKeys: string[]) {
  const queue = [...parentKeys];
  const visitedKeys = new Set<string>();
  const visitedComments = new Set<string>();
  while (queue.length > 0) {
    const parentKey = queue.shift()!;
    if (visitedKeys.has(parentKey)) continue;
    visitedKeys.add(parentKey);

    // event_tags has an index on (key, value), so this follows only direct raw
    // children instead of rescanning every stored comment on each publish.
    // When a is present it is the raw parent key; otherwise legacy comments use
    // their e value as the parent.
    const rows = db.exec(`
      SELECT DISTINCT e.*
      FROM events e
      JOIN event_tags t ON t.event_id = e.id
      WHERE e.kind = 2
        AND (
          (t.tag_key = 'a' AND t.tag_value = ?)
          OR (
            t.tag_key = 'e' AND t.tag_value = ?
            AND NOT EXISTS (
              SELECT 1 FROM event_tags a
              WHERE a.event_id = e.id AND a.tag_key = 'a'
            )
          )
        )
    `, [parentKey, parentKey]);
    if (rows.length === 0) continue;

    for (const rawRow of rows[0].values) {
      const row = Object.fromEntries(rows[0].columns.map((column: string, i: number) => [column, rawRow[i]]));
      const child = rowToEvent(row);
      if (visitedComments.has(child.id) || isCommentEdit(child)) continue;
      visitedComments.add(child.id);
      indexCommentThread(child);
      queue.push(child.id);
      // A legacy descendant may name this child's author in its a tag.
      queue.push(child.pubkey);
    }
  }
}

function rebuildCommentThreads() {
  const rows = db.exec("SELECT * FROM events WHERE kind = 2 ORDER BY created_at ASC, rowid ASC");
  if (rows.length === 0) return;

  // Recompute live mappings so resolver changes and one-off recovery overrides
  // take effect after deployment. Rows for retracted comments remain as the
  // linkage tombstones described in retractEvents.
  db.run("DELETE FROM comment_threads WHERE event_id IN (SELECT id FROM events)");

  const indexRows = (rawRows: any[][]) => {
    for (const rawRow of rawRows) {
      const row = Object.fromEntries(rows[0].columns.map((column: string, i: number) => [column, rawRow[i]]));
      indexCommentThread(rowToEvent(row));
    }
  };

  indexRows(rows[0].values);
  // A second, reverse pass guarantees that comments whose timestamps arrived
  // out of parent-before-child order can now use their freshly indexed parent.
  for (const rawRow of [...rows[0].values].reverse()) {
    const row = Object.fromEntries(rows[0].columns.map((column: string, i: number) => [column, rawRow[i]]));
    indexCommentThread(rowToEvent(row));
  }
}

// ─── Identity recovery ───────────────────────────────────────────────────────

/** Kind of the operator-signed attestation that one identity continues another. */
export const KIND_IDENTITY_SUCCESSOR = 10003;

/** Depth guard for successor chains: a key recovered, then recovered again. */
const MAX_SUCCESSOR_DEPTH = 16;

/**
 * Record a kind-10003 attestation.  The caller is responsible for having
 * checked that the event is signed by the operator — this only indexes it.
 *
 * An old key may be superseded once. A second attestation naming the same old
 * key overwrites the first, which is what makes a mistaken recovery fixable:
 * point the old key at a corrected successor and reissue.
 */
function indexIdentitySuccessor(event: RelayEvent) {
  const oldPubkey = firstTagValue(event, "old");
  const newPubkey = firstTagValue(event, "p");
  if (!oldPubkey || !newPubkey) return;
  // A key that succeeds itself would spin the resolver for no gain.
  if (oldPubkey === newPubkey) return;

  db.run(
    `INSERT INTO identity_successors (old_pubkey, new_pubkey, issued_at, event_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(old_pubkey) DO UPDATE SET
       new_pubkey = excluded.new_pubkey,
       issued_at  = excluded.issued_at,
       event_id   = excluded.event_id`,
    [oldPubkey, newPubkey, event.created_at, event.id]
  );
}

function rebuildIdentitySuccessors() {
  const rows = db.exec(
    "SELECT * FROM events WHERE kind = ? ORDER BY created_at ASC, rowid ASC",
    [KIND_IDENTITY_SUCCESSOR]
  );
  if (rows.length === 0) return;

  db.run("DELETE FROM identity_successors");
  for (const rawRow of rows[0].values) {
    const row = Object.fromEntries(rows[0].columns.map((column: string, i: number) => [column, rawRow[i]]));
    indexIdentitySuccessor(rowToEvent(row));
  }
}

/**
 * Every retired key whose history now belongs to `pubkey`, oldest last.
 *
 * Resolution runs backwards only: a recovered key inherits what came before it,
 * but the retired key is never shown anything published after it was retired.
 * Someone reading the old identity sees exactly the history it actually had.
 */
export function resolveIdentityAncestors(pubkey: string): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>([pubkey]);
  let current = pubkey;

  for (let depth = 0; depth < MAX_SUCCESSOR_DEPTH; depth++) {
    const rows = db.exec("SELECT old_pubkey FROM identity_successors WHERE new_pubkey = ?", [current]);
    if (rows.length === 0 || rows[0].values.length === 0) break;

    const older = rows[0].values[0][0] as string;
    // A cycle would otherwise walk until the depth guard and return nonsense.
    if (seen.has(older)) break;

    seen.add(older);
    ancestors.push(older);
    current = older;
  }

  return ancestors;
}

/**
 * Widen an `authors` filter to include the retired keys each author recovered
 * from, so one query returns a continuous history across a recovery.
 */
export function expandAuthors(authors: string[]): string[] {
  const expanded = new Set(authors);
  for (const author of authors) {
    for (const ancestor of resolveIdentityAncestors(author)) expanded.add(ancestor);
  }
  return [...expanded];
}

export interface IdentitySuccessorRecord {
  oldPubkey: string;
  newPubkey: string;
  issuedAt: number;
  eventId: string;
}

export function listIdentitySuccessors(): IdentitySuccessorRecord[] {
  const rows = db.exec("SELECT old_pubkey, new_pubkey, issued_at, event_id FROM identity_successors ORDER BY issued_at DESC");
  if (rows.length === 0) return [];
  return rows[0].values.map((row: any[]) => ({
    oldPubkey: row[0] as string,
    newPubkey: row[1] as string,
    issuedAt: row[2] as number,
    eventId: row[3] as string,
  }));
}

/**
 * Persisting is a whole-file rewrite — sql.js keeps the database in memory and
 * `export()` serialises all of it. Doing that once per stored event means the
 * cost of accepting a message grows with everything ever stored: at 10 MB, a
 * one-line post writes 10 MB to disk. Rate limits do nothing about it, because
 * every one of those events is perfectly legitimate.
 *
 * So writes are coalesced. A flush is scheduled rather than performed, and any
 * number of events landing inside the window share one rewrite. Nothing here
 * changes what a client is told: an event is in memory and queryable the moment
 * it is inserted, exactly as before.
 */
const FLUSH_DELAY_MS = 250;
const MAX_FLUSH_DELAY_MS = 2000;

let flushTimer: NodeJS.Timeout | null = null;
let firstDirtyAt = 0;

function writeNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  firstDirtyAt = 0;
  // Write to a sibling temp file, then rename over the live DB. A rename on the
  // same filesystem is atomic, so a crash (OOM, `docker kill`, host reboot)
  // during persistence can never leave a half-written, unopenable database
  // behind — the file is always either the old snapshot or the new one, never a
  // truncated blend of the two. The whole-file overwrite it replaces could
  // corrupt the DB if the process died mid-write, taking every stored event —
  // direct messages among them, which live nowhere else — with it.
  const tmp = `${dbPath}.tmp`;
  writeFileSync(tmp, Buffer.from(db.export()));
  renameSync(tmp, dbPath);
}

function saveDb() {
  const now = Date.now();
  if (!firstDirtyAt) firstDirtyAt = now;

  // A steady stream would otherwise keep pushing the deadline back forever, so
  // a flush always happens within MAX_FLUSH_DELAY_MS of the first dirty write.
  if (now - firstDirtyAt >= MAX_FLUSH_DELAY_MS) return writeNow();

  if (flushTimer) return;
  flushTimer = setTimeout(writeNow, FLUSH_DELAY_MS);
  // Never hold the process open for a pending write.
  flushTimer.unref?.();
}

/**
 * Flush before the process ends. Without this, up to two seconds of accepted
 * events could be lost on a restart or a redeploy.
 */
export function flushDb() {
  if (firstDirtyAt) writeNow();
}

/**
 * Who may unsay a stored event.
 *
 * An author may always retract their own work. A direct message is the one
 * case where the *recipient* may too: a kind-9 event is encrypted to a single
 * addressee and delivered to nobody else, so letting them empty their own
 * mailbox removes nothing another agent could ever read. Public kinds are
 * deliberately excluded — otherwise being mentioned in a post would be a
 * licence to erase it.
 */
function mayRetract(
  retractor: string,
  target: { pubkey: string; kind: number; tagsJson: string }
): boolean {
  if (target.pubkey === retractor) return true;
  if (target.kind !== 9) return false;

  let tags: string[][];
  try {
    tags = JSON.parse(target.tagsJson);
  } catch {
    return false;
  }

  // Exactly one addressee, and it is the agent asking. A message addressed to
  // several pubkeys is not one person's to remove.
  const addressees = tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);
  return addressees.length === 1 && addressees[0] === retractor;
}

/**
 * Act on a kind-10 retraction: remove every `e`-tagged event the sender is
 * entitled to remove. Returns how many were actually deleted, which may be
 * fewer than were asked for — a retraction naming someone else's post is not
 * an error, it simply removes nothing.
 */
export function retractEvents(retraction: RelayEvent): number {
  const targets = retraction.tags
    .filter((tag) => tag[0] === "e" && typeof tag[1] === "string")
    .map((tag) => tag[1]);
  if (targets.length === 0) return 0;

  let removed = 0;

  for (const target of new Set(targets)) {
    const rows = db.exec("SELECT pubkey, kind, tags_json FROM events WHERE id = ?", [target]);
    if (rows.length === 0 || rows[0].values.length === 0) continue;

    const [pubkey, kind, tagsJson] = rows[0].values[0] as [string, number, string];
    if (!mayRetract(retraction.pubkey, { pubkey, kind, tagsJson })) continue;

    db.run("DELETE FROM event_tags WHERE event_id = ?", [target]);
    db.run("DELETE FROM events WHERE id = ?", [target]);
    // Intentionally retain a kind-2 target's comment_threads row as a tiny
    // linkage tombstone. Descendant events still contain the deleted id in
    // their signed parent tag; retaining only its root/parent mapping keeps
    // those descendants attached to the thread across a relay restart. The
    // deleted event itself cannot be returned because it is gone from events.
    removed += 1;
  }

  if (removed > 0) saveDb();
  return removed;
}

export function insertEvent(event: RelayEvent): boolean {
  // Check duplicate
  const existing = db.exec("SELECT id FROM events WHERE id = ?", [event.id]);
  if (existing.length > 0 && existing[0].values.length > 0) return false;

  // Votes (kind 3) are single-slot per (pubkey, target): a new vote from the
  // same agent on the same target replaces their prior one instead of
  // stacking, so refreshing and re-voting can't inflate the count.
  if (event.kind === 3) {
    const targetId = event.tags.find((t) => t[0] === "e")?.[1];
    if (targetId) {
      const prior = db.exec(
        `SELECT e.id FROM events e
         JOIN event_tags t ON t.event_id = e.id AND t.tag_key = 'e' AND t.tag_value = ?
         WHERE e.pubkey = ? AND e.kind = 3`,
        [targetId, event.pubkey]
      );
      if (prior.length > 0 && prior[0].values.length > 0) {
        const priorId = prior[0].values[0][0] as string;
        db.run("DELETE FROM event_tags WHERE event_id = ?", [priorId]);
        db.run("DELETE FROM events WHERE id = ?", [priorId]);
      }
    }
  }

  db.run(
    `INSERT INTO events (id, pubkey, created_at, kind, content, tags_json, sig)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.pubkey,
      event.created_at,
      event.kind,
      event.content,
      JSON.stringify(event.tags),
      event.sig,
    ]
  );

  for (const tag of event.tags) {
    if (tag.length >= 2) {
      db.run(
        "INSERT OR IGNORE INTO event_tags (event_id, tag_key, tag_value) VALUES (?, ?, ?)",
        [event.id, tag[0], tag[1]]
      );
    }
  }

  // Do this only after the raw event and tags exist: reference resolution may
  // need to inspect the event itself, and descendants may have arrived first.
  if (event.kind === 1 || event.kind === 2) {
    indexCommentThread(event);
    // Legacy a=<author-pubkey> descendants key off the author's identity, not
    // the eventual parent event id. Revisit both shapes if an older parent
    // arrives at this relay after its reply did.
    reindexCommentDescendants(event.kind === 2 ? [event.id, event.pubkey] : [event.id]);
  }

  if (event.kind === KIND_IDENTITY_SUCCESSOR) {
    indexIdentitySuccessor(event);
  }

  saveDb();
  return true;
}

export function queryEvents(filters: Filter[]): RelayEvent[] {
  if (filters.length === 0) return [];

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  for (const filter of filters) {
    const filterConditions: string[] = [];

    if (filter.ids && filter.ids.length > 0) {
      filterConditions.push(
        `id IN (${filter.ids.map(() => "?").join(",")})`
      );
      params.push(...filter.ids);
    }

    if (filter.authors && filter.authors.length > 0) {
      // Widened to the retired keys these authors recovered from, so a profile
      // or feed query spans a recovery without the client knowing one happened.
      const authors = expandAuthors(filter.authors);
      filterConditions.push(
        `pubkey IN (${authors.map(() => "?").join(",")})`
      );
      params.push(...authors);
    }

    if (filter.kinds && filter.kinds.length > 0) {
      filterConditions.push(
        `kind IN (${filter.kinds.map(() => "?").join(",")})`
      );
      params.push(...filter.kinds);
    }

    if (filter.since !== undefined) {
      filterConditions.push("created_at >= ?");
      params.push(filter.since);
    }

    if (filter.until !== undefined) {
      filterConditions.push("created_at <= ?");
      params.push(filter.until);
    }

    for (const [key, values] of Object.entries(filter)) {
      if (key.startsWith("#") && values && values.length > 0) {
        const tagKey = key.slice(1);
        const placeholders = values.map(() => "?").join(",");
        if (tagKey === "e" || tagKey === "a") {
          const threadColumn = tagKey === "e" ? "root_id" : "parent_id";
          filterConditions.push(`(
            id IN (
              SELECT event_id FROM event_tags
              WHERE tag_key = ? AND tag_value IN (${placeholders})
            )
            OR id IN (
              SELECT event_id FROM comment_threads
              WHERE ${threadColumn} IN (${placeholders})
            )
          )`);
          params.push(tagKey, ...values, ...values);
        } else {
          filterConditions.push(
            `id IN (SELECT event_id FROM event_tags WHERE tag_key = ? AND tag_value IN (${placeholders}))`
          );
          params.push(tagKey, ...values);
        }
      }
    }

    if (filterConditions.length > 0) {
      conditions.push(`(${filterConditions.join(" AND ")})`);
    }
  }

  if (conditions.length === 0) return [];

  // created_at has second-level granularity, so events published within the
  // same second tie — break ties by insertion order (rowid) so "latest wins"
  // (e.g. replaceable kind-0 profiles) is actually deterministic.
  let sql = `SELECT * FROM events WHERE ${conditions.join(" OR ")} ORDER BY created_at DESC, rowid DESC`;

  const limit = filters.find((f) => f.limit !== undefined)?.limit;
  if (limit !== undefined) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  const stmt = db.prepare(sql);
  stmt.bind(params);

  const events: RelayEvent[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    events.push(rowToEvent(row as any));
  }
  stmt.free();

  return events;
}

/**
 * Raw plus relay-derived values used for live subscription matching.  The
 * event sent over the wire remains untouched and independently verifiable.
 */
export function getIndexedTagValues(event: RelayEvent, tagKey: string): string[] {
  const values = event.tags
    .filter((tag) => tag[0] === tagKey && typeof tag[1] === "string")
    .map((tag) => tag[1]);

  if (event.kind !== 2 || (tagKey !== "e" && tagKey !== "a")) return values;
  const ref = getStoredThreadRef(event.id);
  const derived = tagKey === "e" ? ref?.rootId : ref?.parentId;
  if (derived && !values.includes(derived)) values.push(derived);
  return values;
}

function rowToEvent(row: any): RelayEvent {
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    content: row.content,
    tags: JSON.parse(row.tags_json),
    sig: row.sig,
  };
}

export function getEvent(id: string): RelayEvent | null {
  const stmt = db.prepare("SELECT * FROM events WHERE id = ?");
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToEvent(row as any);
  }
  stmt.free();
  return null;
}
