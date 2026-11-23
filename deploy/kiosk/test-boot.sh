#!/bin/bash
# Boots the kiosk ONCE. The next restart goes back to the normal order (GNOME). Run on the car; needs the direct-boot
# entry already set up (kernel and initramfs under /boot/efi/EFI/brava) and passwordless sudo.
set -euo pipefail
LABEL="Brava Kiosk Test"
ARGS="$(sed 's/^BOOT_IMAGE=[^ ]* //' /proc/cmdline | sed 's/ initrd=[^ ]*//')"

ORDER="$(sudo efibootmgr | sed -n 's/^BootOrder: //p')"
OLD="$(sudo efibootmgr | sed -n "s/^Boot\([0-9A-Fa-f]\{4\}\)\* $LABEL\b.*/\1/p")"
for n in $OLD; do sudo efibootmgr -B -b "$n" >/dev/null; done

sudo efibootmgr --create --disk /dev/sda --part 1 --label "$LABEL" --loader '\EFI\brava\vmlinuz.efi' \
	--unicode "$ARGS systemd.unit=brava-kiosk.target initrd=\\EFI\\brava\\initramfs.img" >/dev/null
sudo efibootmgr -o "$ORDER" >/dev/null   # creating an entry puts it first; put the old order back
NEW="$(sudo efibootmgr | sed -n "s/^Boot\([0-9A-Fa-f]\{4\}\)\* $LABEL\b.*/\1/p" | head -1)"
sudo efibootmgr -n "$NEW" | grep -E "BootNext|BootOrder"
echo "The next boot starts the kiosk (Boot$NEW). The one after that is normal."
