#!/usr/bin/env python3
"""
Bluetooth side of the Brava phone link (runs on the car computer, as the car's user).

The Brava Phone Link app on the phone opens a Bluetooth serial (RFCOMM) connection to the UUID below. BlueZ hands this program
the open connection; the program passes the bytes, unchanged, to the Brava app over a private unix socket in the user's runtime
directory. All the protocol handling and checking is in the app (src/lib/phoneLink.ts); this only moves bytes.

Needs: bluez (bluetoothd running), python3-dbus, python3-gobject. Exits if bluetoothd goes away, so systemd restarts it.
"""
import os
import socket
import sys
import threading

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

UUID = "5e8f3c1a-7b2d-4c6e-9a10-3d4b8f6e2a71"  # also in the Android app (link/Protocol.kt)
PROFILE_PATH = "/com/brava/phonelink"
APP_SOCKET = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "brava-phone.sock")


def log(*args):
    print("[phone-bridge]", *args, flush=True)


def relay(source, target, done):
    try:
        while True:
            data = source.recv(4096)
            if not data:
                break
            target.sendall(data)
    except OSError:
        pass
    finally:
        done()


class Profile(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, PROFILE_PATH)
        self.active = None

    @dbus.service.method("org.bluez.Profile1", in_signature="", out_signature="")
    def Release(self):
        log("released by BlueZ")

    @dbus.service.method("org.bluez.Profile1", in_signature="oha{sv}", out_signature="")
    def NewConnection(self, device, fd, properties):
        bluetooth = socket.socket(fileno=fd.take())
        try:
            app = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            app.connect(APP_SOCKET)
        except OSError as error:
            # The Brava app is not running (yet). Refuse; the phone tries again.
            log("app not listening at", APP_SOCKET, "-", error)
            bluetooth.close()
            return
        log("phone connected:", device)
        if self.active:
            for s in self.active:
                try:
                    s.close()
                except OSError:
                    pass
        self.active = (bluetooth, app)
        closed = threading.Event()

        def done():
            if not closed.is_set():
                closed.set()
                for s in (bluetooth, app):
                    try:
                        s.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    s.close()
                log("phone disconnected:", device)

        threading.Thread(target=relay, args=(bluetooth, app, done), daemon=True).start()
        threading.Thread(target=relay, args=(app, bluetooth, done), daemon=True).start()

    @dbus.service.method("org.bluez.Profile1", in_signature="o", out_signature="")
    def RequestDisconnection(self, device):
        log("disconnect requested:", device)


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    loop = GLib.MainLoop()
    manager = dbus.Interface(bus.get_object("org.bluez", "/org/bluez"), "org.bluez.ProfileManager1")
    Profile(bus)
    manager.RegisterProfile(PROFILE_PATH, UUID, {
        "Name": "Brava Phone Link",
        "Role": "server",
        "RequireAuthentication": True,   # the phone must be paired with this computer
        "RequireAuthorization": False,   # and then no prompt on each connection
        "AutoConnect": False,
    })
    log("listening for the phone; handing connections to", APP_SOCKET)

    def owner_changed(name, old, new):
        if name == "org.bluez" and not new:
            log("bluetoothd went away; exiting so it is started again")
            loop.quit()

    bus.add_signal_receiver(owner_changed, "NameOwnerChanged", "org.freedesktop.DBus", "org.freedesktop.DBus")
    loop.run()
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except dbus.DBusException as error:
        log("could not register with BlueZ:", error)
        sys.exit(1)
