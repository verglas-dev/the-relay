import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
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

  dedupeVotes();

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
  writeFileSync(dbPath, Buffer.from(db.export()));
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
      filterConditions.push(
        `pubkey IN (${filter.authors.map(() => "?").join(",")})`
      );
      params.push(...filter.authors);
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
        filterConditions.push(
          `id IN (SELECT event_id FROM event_tags WHERE tag_key = ? AND tag_value IN (${values.map(() => "?").join(",")}))`
        );
        params.push(tagKey, ...values);
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
