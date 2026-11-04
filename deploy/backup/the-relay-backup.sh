#!/usr/bin/env bash
#
# Snapshot what the server cannot rebuild: both Docker volumes, plus the config
# that lives outside the repository (.env and nginx).
#
# This covers a bad deploy, a bad edit, or a corrupted store. It sits on the same
# disk as the data, so it does not cover losing the server. Copy the archives off
# the box for that, encrypted, because host-config holds every live secret.
#
# Install and restore steps are in docs/DEPLOYMENT.md.
set -euo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/the-relay}"
REPO_DIR="${REPO_DIR:-/root/the-relay}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-voicebox}"
KEEP_DAYS="${KEEP_DAYS:-30}"

RELAY_VOLUME="${COMPOSE_PROJECT}_relay-data"
UI_VOLUME="${COMPOSE_PROJECT}_ui-admin-data"

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
work="$BACKUP_ROOT/.incomplete-$stamp"
trap 'rm -rf "$work"' EXIT

# `docker run -v` quietly creates a volume that does not exist, so a wrong name
# would otherwise produce an empty archive that looks like a good backup.
docker volume inspect "$RELAY_VOLUME" "$UI_VOLUME" >/dev/null

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
mkdir "$work"

snapshot_volume() {
  docker run --rm --network none -v "$1:/data:ro" alpine \
    tar czf - --exclude='*.tmp' -C /data . > "$work/$2"
}

snapshot() {
  snapshot_volume "$RELAY_VOLUME" relay-data.tar.gz &&
    snapshot_volume "$UI_VOLUME" ui-admin-data.tar.gz &&
    tar czf "$work/host-config.tar.gz" -C / \
      "${REPO_DIR#/}/.env" \
      etc/nginx/nginx.conf etc/nginx/conf.d etc/nginx/sites-available etc/nginx/snippets
}

# An archive proves nothing until it has been read back. The stores are written
# while this runs, and not all of them atomically, so a JSON file can be caught
# mid-write; that fails here and the snapshot is taken again.
verify() {
  python3 -I - "$work" <<'PY'
import json, os, shutil, sqlite3, sys, tarfile, tempfile

work = sys.argv[1]

def read_archive(name):
    tar = tarfile.open(os.path.join(work, name))
    return tar, {os.path.normpath(m.name): m for m in tar.getmembers() if m.isfile()}

def fail(message):
    sys.exit(f"verify: {message}")

tar, files = read_archive("relay-data.tar.gz")
if "relay.db" not in files:
    fail("relay.db is missing from relay-data")
with tempfile.TemporaryDirectory(dir=work) as scratch:
    copy = os.path.join(scratch, "relay.db")
    with tar.extractfile(files["relay.db"]) as src, open(copy, "wb") as dst:
        shutil.copyfileobj(src, dst)
    db = sqlite3.connect(copy)
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    events = db.execute("SELECT count(*) FROM events").fetchone()[0]
    db.close()
if integrity != "ok":
    fail(f"relay.db failed its integrity check: {integrity}")
if events == 0:
    fail("relay.db holds no events")

tar, files = read_archive("ui-admin-data.tar.gz")
if "town-hall.json" not in files:
    fail("town-hall.json is missing from ui-admin-data")
stores = [name for name in files if name.endswith(".json")]
for name in stores:
    try:
        json.load(tar.extractfile(files[name]))
    except ValueError as error:
        fail(f"{name} does not parse: {error}")

_, files = read_archive("host-config.tar.gz")
if not any(name.endswith("/.env") for name in files):
    fail(".env is missing from host-config")
if "etc/nginx/nginx.conf" not in files:
    fail("nginx.conf is missing from host-config")

print(f"verified: {events} relay events, {len(stores)} JSON stores")
PY
}

for attempt in 1 2 3; do
  if snapshot && verify; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "backup failed after $attempt attempts" >&2
    exit 1
  fi
  echo "attempt $attempt failed; trying again in 30s" >&2
  sleep 30
done

# Visible under its final name only once complete, and old backups are removed
# only after this one has passed, so a run of failures never eats the good ones.
mv "$work" "$BACKUP_ROOT/$stamp"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '.incomplete-*' -mmin +720 -exec rm -rf {} +

echo "backup complete: $BACKUP_ROOT/$stamp ($(du -sh "$BACKUP_ROOT/$stamp" | cut -f1))"
