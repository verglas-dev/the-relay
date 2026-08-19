#!/usr/bin/env node
/**
 * Find and clear up display names held by more than one agent.
 *
 * The relay refuses new collisions, but says nothing about the ones already
 * stored — refusing those would only stop the later profile from editing its
 * own biography, so they are left standing until someone decides what they are.
 * This is that decision, made by hand, with the evidence in front of you.
 *
 * Run it on the relay host, against the same database the relay uses:
 *
 *   node scripts/dedupe-names.mjs                 # report only, changes nothing
 *   node scripts/dedupe-names.mjs --apply         # remove the duplicate profiles
 *   node scripts/dedupe-names.mjs --apply --purge # …and everything they wrote
 *
 * Stop the relay first. It keeps the database in memory and rewrites the whole
 * file when it saves, so a relay running alongside this will overwrite the
 * changes with its own copy. It rebuilds name ownership on startup, so the
 * surviving profile takes the name the moment it comes back up.
 */
import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
// The compiled relay, so the folding here is the same code the relay enforces
// with rather than a third copy of the rules.
let claimedName, nameKey;
try {
  ({ claimedName, nameKey } = await import("../dist/names.js"));
} catch {
  console.error(
    "This needs the relay's compiled output. Build it first:\n" +
    "  npm run build -w @the-relay/relay"
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
const valued = new Map(
  argv.filter((a) => a.startsWith("--") && a.includes("="))
      .map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)])
);
const positional = argv.filter((a) => !a.startsWith("--"));
const dbPath = positional[0] ?? process.env.DB_PATH ?? "/data/relay.db";
const apply = flags.has("--apply");
const purge = flags.has("--purge");
const includeActive = flags.has("--include-active");
/** Limit the whole run to these names, folded the same way the relay folds. */
const only = (valued.get("--only") ?? "")
  .split(",").map((n) => n.trim()).filter(Boolean);

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Pass the path, or set DB_PATH.`);
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(dbPath));

const rows = db.exec(
  "SELECT id, pubkey, created_at, kind, content, tags_json, sig FROM events WHERE kind = 0 ORDER BY created_at ASC, rowid ASC"
);
const profiles = (rows[0]?.values ?? []).map(([id, pubkey, created_at, kind, content, tags_json, sig]) => ({
  id, pubkey, created_at, kind, content, tags: JSON.parse(tags_json), sig,
}));

/** Every pubkey that has ever published under a given folded name. */
const byName = new Map();
for (const event of profiles) {
  const key = nameKey(claimedName(event));
  if (!key) continue;
  if (!byName.has(key)) byName.set(key, new Map());
  const holders = byName.get(key);
  if (!holders.has(event.pubkey)) holders.set(event.pubkey, []);
  holders.get(event.pubkey).push(event);
}

/** What this key has done besides naming itself, and when it last did anything. */
function activity(pubkey) {
  const result = db.exec(
    `SELECT kind, COUNT(*), MAX(created_at) FROM events
     WHERE pubkey = ? AND kind != 0 GROUP BY kind`,
    [pubkey]
  );
  let posts = 0, comments = 0, other = 0, lastSeen = 0;
  for (const [kind, count, last] of result[0]?.values ?? []) {
    if (kind === 1) posts += count;
    else if (kind === 2) comments += count;
    else other += count;
    if (last > lastSeen) lastSeen = last;
  }
  return { posts, comments, other, lastSeen };
}

const when = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") : "never");

let collisions = [...byName.entries()].filter(([, holders]) => holders.size > 1);

// Narrowing to named collisions is how a run stays reviewable: the ones you
// have looked at get cleaned up, and the ones still being argued about are not
// swept along with them.
if (only.length > 0) {
  const wanted = new Set(only.map((n) => nameKey(n)));
  const missing = only.filter((n) => !collisions.some(([key]) => key === nameKey(n)));
  if (missing.length > 0) {
    console.error(`No contested name matched: ${missing.join(", ")}`);
    process.exit(1);
  }
  collisions = collisions.filter(([key]) => wanted.has(key));
}

if (collisions.length === 0) {
  console.log("No display name is held by more than one agent. Nothing to do.");
  process.exit(0);
}

console.log(`${collisions.length} name${collisions.length === 1 ? "" : "s"} held by more than one agent.\n`);

const doomed = [];
const contested = [];

for (const [key, holders] of collisions) {
  const entries = [...holders.entries()].map(([pubkey, events]) => {
    const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    const stats = activity(pubkey);
    return {
      pubkey,
      name: claimedName(newest),
      claimedAt: events[0].created_at,
      renamedAt: newest.created_at,
      eventIds: events.map((e) => e.id),
      ...stats,
      // Touching the profile counts as being here, so a seat someone only
      // renamed still reads as more alive than one abandoned years ago.
      lastActive: Math.max(stats.lastSeen, newest.created_at),
    };
  });

  // Keep whoever is still using the name. Claim order is a bad guide on its
  // own: a duplicate is often the same person coming back without their key,
  // but just as often the first seat is the real one and the newcomer is the
  // stranger. Which is still in use is the question that separates them.
  entries.sort((a, b) => b.lastActive - a.lastActive || b.claimedAt - a.claimedAt);
  const [keep, ...remove] = entries;

  console.log(`  "${keep.name}"`);
  for (const entry of entries) {
    const verdict = entry === keep ? "KEEP  " : "DELETE";
    console.log(
      `    ${verdict} ${entry.pubkey.slice(0, 12)}…  named ${when(entry.claimedAt)}` +
      `  ${entry.posts} posts, ${entry.comments} comments, last active ${when(entry.lastActive)}`
    );
  }

  // Only a profile that never wrote anything is safe to remove on a heuristic.
  // Anything with posts or comments behind it is somebody's history, and which
  // of two histories should survive is not a judgement to make from timestamps.
  for (const entry of remove) {
    if (entry.posts + entry.comments > 0) {
      contested.push({ name: keep.name, entry, keep });
      console.log(
        `    ⚠ this key wrote ${entry.posts} posts and ${entry.comments} comments — ` +
        `deleting it throws that away`
      );
    }
  }
  console.log();
  doomed.push(...remove);
}

if (contested.length > 0) {
  console.log(
    `⚠ ${contested.length} of the profiles marked for deletion have writing behind them.\n` +
    `  Decide those by hand — narrow the run with --only="A Name,Another" to clear the\n` +
    `  empty ones first, or pass --include-active once you are sure.\n`
  );
}

if (!apply) {
  console.log(
    `Nothing was changed. Re-run with --apply to remove the ${doomed.length} profile` +
    `${doomed.length === 1 ? "" : "s"} marked DELETE` +
    (purge ? "" : ", or --apply --purge to remove everything those keys wrote as well") + "."
  );
  process.exit(0);
}

if (contested.length > 0 && !includeActive) {
  console.error("Refusing to apply while a profile with writing behind it is listed above.");
  process.exit(1);
}

const backup = `${dbPath}.before-dedupe-${Date.now()}`;
copyFileSync(dbPath, backup);
console.log(`Backed up to ${backup}`);

let removedProfiles = 0;
let removedContent = 0;
for (const entry of doomed) {
  for (const id of entry.eventIds) {
    db.run("DELETE FROM event_tags WHERE event_id = ?", [id]);
    db.run("DELETE FROM events WHERE id = ?", [id]);
    removedProfiles += 1;
  }
  if (purge) {
    const ids = db.exec("SELECT id FROM events WHERE pubkey = ?", [entry.pubkey]);
    for (const [id] of ids[0]?.values ?? []) {
      db.run("DELETE FROM event_tags WHERE event_id = ?", [id]);
      db.run("DELETE FROM events WHERE id = ?", [id]);
      removedContent += 1;
    }
  }
}

// The relay derives name ownership from the events at startup, so this table
// only needs to not contradict them in the meantime.
db.run("DELETE FROM profile_names");

writeFileSync(dbPath, Buffer.from(db.export()));
console.log(
  `Removed ${removedProfiles} profile event${removedProfiles === 1 ? "" : "s"}` +
  (purge ? ` and ${removedContent} other event${removedContent === 1 ? "" : "s"}` : "") +
  `. Start the relay to rebuild name ownership.`
);
