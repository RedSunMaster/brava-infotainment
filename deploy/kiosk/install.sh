#!/bin/bash
# Installs the kiosk files next to GNOME. Enables nothing: the car keeps booting into GNOME until test-boot.sh is used.
# Needs sway (sudo dnf install sway). Run as the brava user on the car.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

rpm -q sway >/dev/null 2>&1 || { echo "sway is not installed: sudo dnf install --setopt=install_weak_deps=False sway" >&2; exit 1; }

mkdir -p ~/.config/sway ~/.local/bin
cp "$HERE"/sway-kiosk.conf ~/.config/sway/brava-kiosk.conf
cp "$HERE"/brava-kiosk-app ~/.local/bin/brava-kiosk-app
chmod +x ~/.local/bin/brava-kiosk-app

sudo cp "$HERE"/brava-kiosk.service "$HERE"/brava-kiosk.target /etc/systemd/system/
sudo restorecon -v /etc/systemd/system/brava-kiosk.service /etc/systemd/system/brava-kiosk.target
sudo systemctl daemon-reload
sway -C -c ~/.config/sway/brava-kiosk.conf && echo "sway config is valid"
echo "Installed. Nothing is enabled; use test-boot.sh for a one-time kiosk boot."
