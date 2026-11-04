#!/usr/bin/env bash
#
# Deploy the-relay: bring this checkout up to main, rebuild what changed, swap it
# in, and put the old version back if it does not come up.
#
#   relayup             pull main, rebuild the UI, and the relay if its code changed
#   relayup --relay     rebuild the relay too, even if its code did not change
#   relayup --no-cache  build from scratch instead of reusing Docker's cache
#   relayup --dry-run   show what would happen, and change nothing
#
# Installed rather than run from the checkout, because a script being read by bash
# should not be replaced by its own `git pull`. Reinstall after changing it:
#
#   install -m 755 deploy/relayup.sh /usr/local/sbin/relayup
#
# PROJECT and SITES below describe this deployment; change them for another.
set -euo pipefail

REPO_DIR="${RELAY_DIR:-/root/the-relay}"
STATE_FILE="${RELAY_STATE_FILE:-/var/lib/the-relay/relay-commit}"
HEALTH_WAIT_SECONDS="${HEALTH_WAIT_SECONDS:-90}"
PROJECT=voicebox
SITES=(https://the-relay.app/ https://verglas.town/ https://verglas.town/street)

force_relay=false
dry_run=false
build_flags=()

for arg in "$@"; do
  case "$arg" in
    --relay) force_relay=true ;;
    --no-cache) build_flags+=(--no-cache) ;;
    --dry-run) dry_run=true ;;
    *) echo "usage: relayup [--relay] [--no-cache] [--dry-run]" >&2; exit 2 ;;
  esac
done

say() { echo "==> $*"; }
die() { echo "relayup: $*" >&2; exit 1; }

wait_for() {
  local deadline=$((SECONDS + HEALTH_WAIT_SECONDS))
  until "$1"; do
    if ((SECONDS >= deadline)); then return 1; fi
    sleep 2
  done
}

sites_answer() {
  local site
  for site in "${SITES[@]}"; do
    curl -fs -o /dev/null -m 15 "$site" || return 1
  done
}

relay_is_healthy() {
  [ "$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q relay)" 2>/dev/null)" = healthy ]
}

ui_check() { wait_for sites_answer; }
relay_check() { wait_for relay_is_healthy; }

# Build first, so a failed build leaves the site exactly as it was. Keep whatever
# is running under a rollback tag, because the build moves `latest` off it.
deploy_service() {
  local service="$1" check="$2" image="$PROJECT-$1"
  local container previous="" new can_roll_back=false

  container="$(docker compose ps -q "$service")"
  if [ -n "$container" ]; then
    previous="$(docker inspect --format '{{.Image}}' "$container")"
  fi

  say "Building $service"
  docker compose build "${build_flags[@]}" "$service" ||
    die "the $service build failed. The site is untouched."

  new="$(docker image inspect --format '{{.Id}}' "$image:latest")"
  if [ -n "$previous" ] && [ "$previous" != "$new" ]; then
    if docker tag "$previous" "$image:rollback" 2>/dev/null; then
      can_roll_back=true
    else
      say "Could not keep the running $service as a rollback; continuing without one"
    fi
  fi

  say "Starting $service"
  docker compose up -d --no-deps "$service"

  say "Waiting for $service to come up"
  if "$check"; then
    say "$service is up"
    return
  fi

  docker compose logs --tail=20 "$service" >&2 || true
  if ! "$can_roll_back"; then
    die "$service did not come up, and there is no earlier version to return to."
  fi

  echo "relayup: the new $service did not come up. Putting the old one back." >&2
  docker tag "$image:rollback" "$image:latest"
  docker compose up -d --no-deps "$service"
  if "$check"; then
    die "rolled back, and the old $service is running. Nothing new is live."
  fi
  die "rolled back, but $service still is not answering. This needs a look now."
}

cd "$REPO_DIR"

exec 9>/run/lock/relayup
flock -n 9 || die "another relayup is already running."

# Building a dirty tree would put code on the site that is in no commit.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  die "the changes above are not committed. Commit or stash them first."
fi

git fetch -q origin main || die "could not reach GitHub. Nothing was deployed."

# Restarting the relay drops every agent's connection, so it only happens when its
# own code moved. What it last ran is written down rather than read from this
# pull, so a failed relay deploy is retried next time instead of forgotten. With
# nothing written down yet, what is running is taken to be current.
relay_target="$(git log -1 --format=%H origin/main -- packages/relay)"
relay_current="$(cat "$STATE_FILE" 2>/dev/null || echo "$relay_target")"
deploy_relay=false
if "$force_relay" || [ "$relay_current" != "$relay_target" ]; then
  deploy_relay=true
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
incoming="$(git log --oneline HEAD..origin/main)"

if [ -n "$(git diff --name-only HEAD origin/main -- package-lock.json)" ] && ! "$deploy_relay"; then
  say "package-lock.json changed. If the relay's dependencies moved, run: relayup --relay"
fi

if "$dry_run"; then
  if [ "$branch" != main ]; then say "Would switch from $branch to main"; fi
  if [ -n "$incoming" ]; then
    say "Would pull:"
    echo "$incoming"
  else
    say "Nothing new to pull"
  fi
  say "Would rebuild the UI (a no-op if nothing it uses changed)"
  if "$deploy_relay"; then
    say "Would rebuild and restart the relay"
  else
    say "Would leave the relay alone: its code has not changed"
  fi
  exit 0
fi

if [ "$branch" != main ]; then
  say "Switching from $branch to main"
  git switch -q main
fi
git pull -q --ff-only origin main ||
  die "this checkout has diverged from main on GitHub. Nothing was deployed."

if "$deploy_relay"; then
  deploy_service relay relay_check
else
  say "Leaving the relay alone: its code has not changed"
fi
mkdir -p "$(dirname "$STATE_FILE")"
echo "$relay_target" > "$STATE_FILE"

deploy_service ui ui_check

# Each deploy leaves the image before last untagged, and they add up on this disk.
docker image prune -f > /dev/null || true

say "Live: $(git log -1 --format='%h %s')"
say "To go back: docker tag $PROJECT-ui:rollback $PROJECT-ui:latest && docker compose up -d --no-deps ui"
