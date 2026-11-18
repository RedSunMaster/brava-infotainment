#!/usr/bin/python3
"""The gap-filler between the boot splash and the app: a full-screen window with the same logo in the same place, put up as soon as the
desktop session starts and taken down once the app's own opening screen (which looks identical) is showing. The app tells us by writing
$XDG_RUNTIME_DIR/brava-ready. Gives up by itself after a minute so it can never trap the screen."""
import os
import sys

import gi

gi.require_version("Gdk", "4.0")
gi.require_version("Gtk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

HERE = os.path.dirname(os.path.realpath(__file__))
PICTURE = os.path.join(HERE, "splash.png")
FLAG = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "brava-ready")
BACKGROUND = "#060a14"
HOLD_AFTER_READY_MS = 700
GIVE_UP_S = 60

try:
    os.remove(FLAG)
except OSError:
    pass

CSS = f"window.brava-splash {{ background: {BACKGROUND}; }}".encode()


class Splash(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="nz.brava.EarlySplash")

    def do_activate(self):
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.window = Gtk.ApplicationWindow(application=self)
        self.window.add_css_class("brava-splash")
        self.window.set_decorated(False)
        self.picture = Gtk.Picture.new_for_filename(PICTURE)
        self.picture.set_can_shrink(True)
        self.picture.set_halign(Gtk.Align.CENTER)
        self.picture.set_valign(Gtk.Align.CENTER)
        self.window.set_child(self.picture)
        self.window.fullscreen()
        self.window.present()
        # The logo is 90 % of the short side of the screen, exactly as in the boot splash and the app.
        GLib.timeout_add(50, self.size_picture)
        GLib.timeout_add(100, self.check_ready)
        GLib.timeout_add_seconds(GIVE_UP_S, self.finish)
        self.ready_seen = False

    def size_picture(self):
        width, height = self.window.get_width(), self.window.get_height()
        if width < 50 or height < 50:
            return True
        target = 0.9 * min(width, height)
        texture = self.picture.get_paintable()
        ratio = texture.get_intrinsic_height() / texture.get_intrinsic_width()
        self.picture.set_size_request(int(target), int(target * ratio))
        return False

    def check_ready(self):
        if not self.ready_seen and os.path.exists(FLAG):
            self.ready_seen = True
            GLib.timeout_add(HOLD_AFTER_READY_MS, self.finish)
        return True

    def finish(self):
        self.quit()
        return False


sys.exit(Splash().run(None))
