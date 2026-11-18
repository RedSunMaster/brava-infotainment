#!/bin/bash
# One-off: install the update timer for the current user, pointing at this checkout.
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p ~/.config/systemd/user
sed "s#%h/brava-build#$REPO#" "$(dirname "$0")/brava-update.service" >~/.config/systemd/user/brava-update.service
cp "$(dirname "$0")/brava-update.timer" ~/.config/systemd/user/
chmod +x "$REPO/deploy/updater/update.sh"
systemctl --user daemon-reload
systemctl --user enable --now brava-update.timer
systemctl --user list-timers brava-update.timer --no-pager
