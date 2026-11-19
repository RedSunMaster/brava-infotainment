#!/bin/bash
# Sets up the Bluetooth phone link on the car computer (Fedora): Bluetooth on at boot, and the bridge that hands the phone's
# connection to the Brava app. Run as the car's user (it asks for sudo where needed). Safe to run again.
#   deploy/phone/install.sh           install
#   deploy/phone/install.sh --undo    remove the bridge
# Then pair the phone once: Settings > Bluetooth on the car computer, pair the Pixel, and mark it trusted. See deploy/phone/README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--undo" ]; then
	systemctl --user disable --now brava-phone-bridge.service 2>/dev/null || true
	rm -f ~/.config/systemd/user/brava-phone-bridge.service ~/.local/share/brava/phone-bridge.py
	systemctl --user daemon-reload
	echo "phone bridge removed"
	exit 0
fi

rpm -q python3-dbus >/dev/null 2>&1 || sudo dnf install -y python3-dbus
rpm -q python3-gobject >/dev/null 2>&1 || sudo dnf install -y python3-gobject

# Bluetooth running now and at every boot, and the adapter powered on without anyone pressing anything.
sudo systemctl enable --now bluetooth
if grep -q '^#\?AutoEnable=' /etc/bluetooth/main.conf; then
	sudo sed -i 's/^#\?AutoEnable=.*/AutoEnable=true/' /etc/bluetooth/main.conf
else
	sudo sed -i '/^\[Policy\]/a AutoEnable=true' /etc/bluetooth/main.conf
fi
bluetoothctl power on >/dev/null || true

mkdir -p ~/.local/share/brava ~/.config/systemd/user
cp "$HERE"/phone-bridge.py ~/.local/share/brava/
chmod +x ~/.local/share/brava/phone-bridge.py
cp "$HERE"/brava-phone-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brava-phone-bridge.service
# Start at boot even before anyone logs in (the car logs in by itself, but this makes it independent of that).
loginctl enable-linger "$USER" || true
echo "installed. Pair the phone in Settings > Bluetooth, then open Brava Phone Link on it and choose this computer."
echo "Check it with: journalctl --user -u brava-phone-bridge -f"
