import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export default class BravaNoOverview extends Extension {
	enable() {
		// The overview opens when the session finishes starting; close it then (and now, if enabled later).
		this._startup = Main.layoutManager.connect("startup-complete", () => Main.overview.hide());
		if (!Main.layoutManager._startingUp) Main.overview.hide();
	}

	disable() {
		if (this._startup) Main.layoutManager.disconnect(this._startup);
		this._startup = null;
	}
}
