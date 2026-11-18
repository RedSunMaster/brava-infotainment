#!/bin/bash
# Installs the FIAT Brava start-up on this computer (Fedora): the boot splash, the hidden boot menu, and the early desktop splash.
# Run as the car's user (it asks for sudo where it needs it). Safe to run again.
#   deploy/boot/install.sh            install
#   deploy/boot/install.sh --undo     put the standard boot splash back
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--undo" ]; then
	sudo plymouth-set-default-theme -R bgrt
	rm -f ~/.config/autostart/brava-early-splash.desktop
	echo "standard boot splash restored"
	exit 0
fi

# 1. The Plymouth boot splash theme.
rpm -q plymouth-plugin-script >/dev/null 2>&1 || sudo dnf install -y plymouth-plugin-script
sudo mkdir -p /usr/share/plymouth/themes/brava
sudo cp "$HERE"/plymouth/{brava.plymouth,brava.script,logo.png,glow.png} /usr/share/plymouth/themes/brava/
sudo plymouth-set-default-theme -R brava      # also rebuilds the boot image, which takes a minute

# 2. Quiet boot with no menu: Fedora already boots "rhgb quiet" with the menu hidden; make sure of both.
sudo grubby --update-kernel=ALL --args="quiet splash" >/dev/null
sudo grub2-editenv - set menu_auto_hide=1

# 3. The early desktop splash that covers the gap before the app opens.
mkdir -p ~/.local/share/brava ~/.config/autostart
cp "$HERE"/early-splash.py "$HERE"/splash.png ~/.local/share/brava/
chmod +x ~/.local/share/brava/early-splash.py
cp "$HERE"/brava-early-splash.desktop ~/.config/autostart/

# 4. A plain dark desktop in the same colour, in case the desktop shows for a moment anywhere.
gsettings set org.gnome.desktop.background picture-options none
gsettings set org.gnome.desktop.background color-shading-type solid
gsettings set org.gnome.desktop.background primary-color '#060a14'
gsettings set org.gnome.desktop.background picture-uri ''
gsettings set org.gnome.desktop.background picture-uri-dark ''
echo "installed; restart to see it"
