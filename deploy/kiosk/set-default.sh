#!/bin/bash
# Makes the kiosk the default boot. GNOME stays available: the existing "Brava Direct" (GNOME, direct) and "Fedora" (GRUB)
# entries remain behind it in the boot order. Run on the car; needs the direct-boot entry set up and passwordless sudo.
#
# Back to GNOME for one boot (over SSH):  sudo efibootmgr -n <Brava Direct number> && sudo reboot
# Back to GNOME for good:                 sudo efibootmgr -o <Brava Direct number>,<rest>   (or run: set-default.sh --undo)
set -euo pipefail
LABEL="Brava Kiosk"
ARGS="$(sed 's/^BOOT_IMAGE=[^ ]* //' /proc/cmdline | sed 's/ initrd=[^ ]*//; s/ systemd\.unit=[^ ]*//')"

entry_of() { sudo efibootmgr | sed -n "s/^Boot\([0-9A-Fa-f]\{4\}\)\* $1\b.*/\1/p" | head -1; }
order() { sudo efibootmgr | sed -n 's/^BootOrder: //p'; }

if [ "${1:-}" = "--undo" ]; then
	K="$(entry_of "$LABEL")"
	REST="$(order | tr ',' '\n' | grep -v -x "${K:-none}" | paste -sd,)"
	sudo efibootmgr -o "$REST" | grep BootOrder
	[ -n "$K" ] && sudo efibootmgr -B -b "$K" >/dev/null && echo "removed Boot$K"
	exit 0
fi

# Remove old kiosk entries (including the one-time test entry), then create the real one.
for L in "Brava Kiosk Test" "$LABEL"; do
	for n in $(sudo efibootmgr | sed -n "s/^Boot\([0-9A-Fa-f]\{4\}\)\* $L\b.*/\1/p"); do sudo efibootmgr -B -b "$n" >/dev/null; done
done
sudo efibootmgr -N >/dev/null 2>&1 || true   # drop any pending BootNext

BEFORE="$(order)"
sudo efibootmgr --create --disk /dev/sda --part 1 --label "$LABEL" --loader '\EFI\brava\vmlinuz.efi' \
	--unicode "$ARGS systemd.unit=brava-kiosk.target initrd=\\EFI\\brava\\initramfs.img" >/dev/null
K="$(entry_of "$LABEL")"
# New entry first, then everything that was there before, in its old order.
REST="$(echo "$BEFORE" | tr ',' '\n' | grep -v -x "$K" | paste -sd,)"
sudo efibootmgr -o "$K,$REST" | grep BootOrder
echo "Kiosk is the default (Boot$K). GNOME entries are still in the order behind it."
