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
PROJECT="${RELAY_PROJECT:-voicebox}"
SITES=(https://the-relay.app/ https://verglas.town/ https://verglas.town/street)

force_relay=false
dry_run=false
build_flags=()

# One line for each service this run really replaced, saying how to undo it. Empty
# means nothing new went live, however much was rebuilt.
ways_back=()

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

# Build first, so a failed build leaves the site exactly as it was.
#
# The running image has to be tagged before that build. `docker compose build`
# forgets the image `latest` moves off, even while a container is running it, and
# after that it cannot be found by its ID. If it is already lost that way, `latest`
# is the nearest thing left. The rollback tag only moves once the build has produced
# something different, so a deploy that changes nothing keeps the real way back.
#
# "Different" has to mean the contents. Every compose build gets a new image ID,
# even when nothing changed.
fingerprint() {
  docker image inspect --format '{{json .RootFS.Layers}}{{json .Config}}' "$1"
}

deploy_service() {
  local service="$1" check="$2" image="$PROJECT-$1"
  local container previous before="" kept=false can_roll_back=false changed=true

  container="$(docker compose ps -q "$service")"
  if [ -n "$container" ]; then
    previous="$(docker inspect --format '{{.Image}}' "$container")"
    if docker tag "$previous" "$image:pre-deploy" 2>/dev/null ||
      docker tag "$image:latest" "$image:pre-deploy" 2>/dev/null; then
      kept=true
      before="$(fingerprint "$image:pre-deploy")"
    else
      say "Could not keep the running $service as a rollback; continuing without one"
    fi
  fi

  say "Building $service"
  if ! docker compose build "${build_flags[@]}" "$service"; then
    if "$kept"; then docker rmi "$image:pre-deploy" > /dev/null 2>&1 || true; fi
    die "the $service build failed. The site is untouched."
  fi

  # The build reads the checkout as it goes, so a merge or an edit landing part way
  # can leave an image of no commit at all. There is no telling from here, so it is
  # not put live.
  if [ "$(git rev-parse HEAD)" != "$deploying" ] ||
    [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    if "$kept"; then
      docker tag "$image:pre-deploy" "$image:latest"
      docker rmi "$image:pre-deploy" > /dev/null 2>&1 || true
    fi
    die "the checkout changed during the $service build, so that build was thrown away and $service is untouched. Run relayup again."
  fi

  if "$kept"; then
    if [ "$before" = "$(fingerprint "$image:latest")" ]; then
      # Nothing changed, so leave things as they were found: what is running keeps
      # its name, and the rebuilt copy of it is forgotten.
      docker tag "$image:pre-deploy" "$image:latest"
      changed=false
    elif docker tag "$image:pre-deploy" "$image:rollback"; then
      can_roll_back=true
    fi
    docker rmi "$image:pre-deploy" > /dev/null 2>&1 || true
  fi

  say "Starting $service"
  docker compose up -d --no-deps "$service"

  say "Waiting for $service to come up"
  if "$check"; then
    say "$service is up"
    if "$changed"; then
      if "$can_roll_back"; then
        ways_back+=("To go back: docker tag $image:rollback $image:latest && docker compose up -d --no-deps $service")
      else
        ways_back+=("No earlier $service is kept, so there is nothing to go back to")
      fi
    fi
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

# The commit this run is about. The checkout can move while a build takes minutes,
# and nothing here stops someone merging, so later steps compare against this rather
# than trusting where HEAD has got to.
deploying="$(git rev-parse HEAD)"

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

# Name the commit this run built, and call it live only if an image was replaced. A
# run that found nothing new once finished just after a merge landed, and announced
# that merge as live while the old image kept running.
built="$(git log -1 --format='%h %s' "$deploying")"
if ((${#ways_back[@]})); then
  say "Live: $built"
  for way_back in "${ways_back[@]}"; do say "$way_back"; done
else
  say "Nothing new went live: what is running already matches $built"
fi

if [ "$(git rev-parse HEAD)" != "$deploying" ]; then
  die "the checkout moved to $(git log -1 --format='%h %s') during this run, so that is not live. Run relayup again."
fi
