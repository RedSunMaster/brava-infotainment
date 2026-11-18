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
sudo rm -f /usr/share/plymouth/themes/brava/*.png      # pictures from an earlier design
sudo cp "$HERE"/plymouth/brava.plymouth "$HERE"/plymouth/brava.script "$HERE"/plymouth/*.png /usr/share/plymouth/themes/brava/
sudo plymouth-set-default-theme -R brava      # also rebuilds the boot image, which takes a minute

# 2. Quiet boot with no menu: Fedora already boots "rhgb quiet" with the menu hidden; make sure of both.
sudo grubby --update-kernel=ALL --args="quiet splash" >/dev/null
sudo grub2-editenv - set menu_auto_hide=1
# 2b. Play the animation straight through. Without this Plymouth starts on the firmware's temporary screen (simpledrm), and the
# graphics driver (i915) taking over a second or two later restarts or blanks it mid-way. So: load i915 inside the boot image and tell
# Plymouth to wait for it. Also never show the GRUB menu (Fedora only hides it after a boot that ran 2 minutes, otherwise it waits 5 s).
echo 'add_drivers+=" i915 "' | sudo tee /etc/dracut.conf.d/brava-i915.conf >/dev/null
sudo grubby --update-kernel=ALL --args="plymouth.use-simpledrm=0" >/dev/null
sudo sed -i -e 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=0/' /etc/default/grub
grep -q '^GRUB_TIMEOUT_STYLE=' /etc/default/grub && sudo sed -i 's/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=hidden/' /etc/default/grub || echo 'GRUB_TIMEOUT_STYLE=hidden' | sudo tee -a /etc/default/grub >/dev/null
sudo grub2-mkconfig -o /boot/grub2/grub.cfg >/dev/null 2>&1
sudo dracut --force --regenerate-all

# 3. The early desktop splash that covers the gap before the app opens.
mkdir -p ~/.local/share/brava ~/.config/autostart
cp "$HERE"/early-splash.py "$HERE"/splash.png ~/.local/share/brava/
chmod +x ~/.local/share/brava/early-splash.py
cp "$HERE"/brava-early-splash.desktop ~/.config/autostart/

# 3b. GNOME shows its Activities overview after an automatic login, which hides the app: a tiny extension closes it at start-up.
EXT=~/.local/share/gnome-shell/extensions/brava-no-overview@brava
mkdir -p "$EXT"
cp "$HERE"/gnome-extension/{metadata.json,extension.js} "$EXT"/
python3 - <<'PY'
import ast, subprocess
current = subprocess.run(["gsettings", "get", "org.gnome.shell", "enabled-extensions"], capture_output=True, text=True).stdout.strip()
names = ast.literal_eval(current.replace("@as ", "")) if current else []
if "brava-no-overview@brava" not in names:
    names.append("brava-no-overview@brava")
    subprocess.run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(names)], check=True)
PY
# (the extension is picked up at the next login)

# 4. A plain dark desktop in the same colour, in case the desktop shows for a moment anywhere.
gsettings set org.gnome.desktop.background picture-options none
gsettings set org.gnome.desktop.background color-shading-type solid
gsettings set org.gnome.desktop.background primary-color '#0a0705'
gsettings set org.gnome.desktop.background picture-uri ''
gsettings set org.gnome.desktop.background picture-uri-dark ''
echo "installed; restart to see it"
