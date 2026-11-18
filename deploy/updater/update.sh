#!/bin/bash
# Updates the packaged app from git. The app calls this itself: --check for the status bar's "update available" icon,
# and a plain run when that icon is tapped. Also safe to run by hand.
#   update.sh --check  print "<current> <latest> <subject>" when a newer commit exists, nothing otherwise; changes nothing
#   update.sh          pull the newest commit, rebuild the packaged app and restart it
#   update.sh --force  rebuild and restart even if nothing is new
set -uo pipefail

if [ -z "${BRAVA_UPDATE_COPY:-}" ]; then
	COPY="$(mktemp /tmp/brava-update.XXXXXX)"; cp "$0" "$COPY"
	export BRAVA_UPDATE_COPY=1 BRAVA_REPO="${BRAVA_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
	exec bash "$COPY" "$@"
fi

REPO="$BRAVA_REPO"
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
# Stop every copy: units of earlier launches (named brava-app-*), and any strays.
systemctl --user stop 'brava-app*.service' brava-test.service >/dev/null 2>&1
for i in $(seq 1 20); do pgrep -x brava-infotainm >/dev/null || break; [ "$i" -ge 10 ] && pkill -9 -x brava-infotainm; sleep 1; done
# A fresh unit name each time, so a unit that is slow to go away can never block the start; errors are kept in the log.
for try in 1 2 3 4 5; do
	if systemd-run --user --quiet --collect --unit="brava-app-$(date +%s)" --working-directory="$(dirname "$APP")" "$APP" >>"$STATE/update.log" 2>&1; then
		log "now running ${REMOTE:0:7}"
		exit 0
	fi
	log "start attempt $try failed"; sleep 2
done
log "could not start the app"
exit 1
