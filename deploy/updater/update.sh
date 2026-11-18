#!/bin/bash
# Updates the packaged app from git. The app calls this itself: --check for the status bar's "update available" icon,
# and a plain run when that icon is tapped. Also safe to run by hand.
#   update.sh --check  print "<current> <latest> <subject>" when a newer commit exists, nothing otherwise; changes nothing
#   update.sh          pull the newest commit, rebuild the packaged app and restart it
#   update.sh --force  rebuild and restart even if nothing is new
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/brava-update"
APP="$REPO/out/brava-infotainment-linux-x64/brava-infotainment"
BRANCH="${BRAVA_BRANCH:-master}"
mkdir -p "$STATE"
log() { echo "$(date '+%F %T') $*" | tee -a "$STATE/update.log"; }

if [ "${1:-}" = "--check" ]; then
	cd "$REPO" && git fetch -q origin "$BRANCH" 2>/dev/null || exit 0
	LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse "origin/$BRANCH")
	[ "$LOCAL" != "$REMOTE" ] && echo "${LOCAL:0:7} ${REMOTE:0:7} $(git log -1 --format=%s "origin/$BRANCH")"
	exit 0
fi

exec 9>"$STATE/lock"
flock -n 9 || { echo "another update is running"; exit 0; }
cd "$REPO"

git fetch -q origin "$BRANCH" || { log "fetch failed (offline?)"; exit 0; }
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--force" ]; then exit 0; fi
# A commit that failed to build is not retried until a newer one arrives.
if [ "$REMOTE" = "$(cat "$STATE/failed" 2>/dev/null)" ] && [ "${1:-}" != "--force" ]; then exit 0; fi

log "updating ${LOCAL:0:7} -> ${REMOTE:0:7}"
# Local edits to tracked files (e.g. a hand-copied config) must not block the update.
git reset -q --hard "origin/$BRANCH" || { log "reset failed"; exit 1; }

if [ "$LOCAL" = "$REMOTE" ] || ! git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json || [ ! -d node_modules ]; then
	log "installing dependencies"
	ONNXRUNTIME_NODE_INSTALL_CUDA=skip nice -n 10 npm ci --no-audit --no-fund >>"$STATE/build.log" 2>&1 || { log "npm ci failed, see $STATE/build.log"; echo "$REMOTE" >"$STATE/failed"; exit 1; }
fi

log "building"
nice -n 10 npm run package >"$STATE/build.log" 2>&1 || { log "build failed, see $STATE/build.log"; echo "$REMOTE" >"$STATE/failed"; exit 1; }
rm -f "$STATE/failed"

log "restarting app"
systemctl --user stop brava-app.service brava-test.service 2>/dev/null
pkill -x brava-infotainm 2>/dev/null
sleep 1
systemctl --user reset-failed brava-app.service 2>/dev/null
systemd-run --user --quiet --collect --unit=brava-app --working-directory="$(dirname "$APP")" "$APP" || { log "could not start the app"; exit 1; }
log "now running ${REMOTE:0:7}"
