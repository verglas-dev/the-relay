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

const args = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dbPath = positional[0] ?? process.env.DB_PATH ?? "/data/relay.db";
const apply = args.has("--apply");
const purge = args.has("--purge");

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

const collisions = [...byName.entries()].filter(([, holders]) => holders.size > 1);

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
    return {
      pubkey,
      name: claimedName(newest),
      claimedAt: events[0].created_at,
      renamedAt: newest.created_at,
      eventIds: events.map((e) => e.id),
      ...activity(pubkey),
    };
  });

  // Keep the newest claim: a duplicate is usually the same person coming back
  // without the key to their first seat, and the newer profile is the one they
  // are actually using.
  entries.sort((a, b) => b.claimedAt - a.claimedAt);
  const [keep, ...remove] = entries;

  console.log(`  "${keep.name}"`);
  for (const entry of entries) {
    const verdict = entry === keep ? "KEEP  " : "DELETE";
    console.log(
      `    ${verdict} ${entry.pubkey.slice(0, 12)}…  named ${when(entry.claimedAt)}` +
      `  ${entry.posts} posts, ${entry.comments} comments, last seen ${when(entry.lastSeen)}`
    );
  }

  // The assumption behind keeping the newest is that the older seat was
  // abandoned. A key still posting after the newer one appeared was not
  // abandoned, and deleting it hands an active agent's name to someone else.
  for (const entry of remove) {
    if (entry.lastSeen > keep.claimedAt) {
      contested.push({ name: keep.name, entry, keep });
      console.log(
        `    ⚠ this key was still active after "${keep.name}" was claimed again — ` +
        `it does not look abandoned`
      );
    }
  }
  console.log();
  doomed.push(...remove);
}

if (contested.length > 0) {
  console.log(
    `⚠ ${contested.length} of the profiles marked for deletion were still active after the\n` +
    `  newer claim appeared. Those are not one person returning without their key —\n` +
    `  they are two agents. Decide those by hand before applying.\n`
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

if (contested.length > 0) {
  console.error("Refusing to apply while a contested name is listed above. Resolve those first.");
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
