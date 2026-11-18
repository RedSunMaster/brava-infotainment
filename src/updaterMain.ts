import { app, BrowserWindow, ipcMain } from "electron";
import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";

/** What the status bar shows about updates. */
export interface UpdateState {
	/** "idle" = up to date or not checked, "available" = a newer commit exists, "updating" = rebuilding, "failed" = the last update did not finish. */
	phase: "idle" | "available" | "updating" | "failed";
	/** Short commit ids and the newest commit's title, when an update is available. */
	current?: string;
	latest?: string;
	subject?: string;
}

const CHECK_EVERY_MS = 5 * 60_000;
const FIRST_CHECK_MS = 20_000;
const UNIT = "brava-updating";

/** The git checkout this packaged app was built from (…/out/<app>/<binary>), when the updater script is there. */
function findRepo(): string | null {
	if (process.env.BRAVA_REPO && existsSync(join(process.env.BRAVA_REPO, "deploy/updater/update.sh"))) return process.env.BRAVA_REPO;
	let dir = dirname(process.execPath);
	for (let i = 0; i < 5; i++) {
		if (existsSync(join(dir, ".git")) && existsSync(join(dir, "deploy/updater/update.sh"))) return dir;
		dir = dirname(dir);
	}
	return null;
}

/**
 * Lets the app update itself from git on the car's computer (Linux, installed from a checkout). It looks for a newer commit
 * every few minutes and tells the window; tapping the status bar icon rebuilds and restarts through the updater script,
 * which runs as its own systemd unit so it survives the app being stopped.
 */
export function startUpdater(getWindow: () => BrowserWindow | null): void {
	const repo = process.platform === "linux" && app.isPackaged ? findRepo() : null;
	let state: UpdateState = { phase: "idle" };
	const script = repo ? join(repo, "deploy/updater/update.sh") : "";

	const publish = (next: UpdateState) => {
		state = next;
		getWindow()?.webContents.send("update-state", state);
	};

	ipcMain.handle("update:state", () => state);
	if (!repo) return;

	const check = () => {
		if (state.phase === "updating") return;
		execFile(script, ["--check"], { cwd: repo, timeout: 60_000 }, (error, stdout) => {
			if (error) return;
			const [current, latest, ...rest] = stdout.trim().split(" ");
			if (!latest) {
				if (state.phase !== "idle") publish({ phase: "idle" });
				return;
			}
			const subject = rest.join(" ");
			if (state.phase === "available" && state.latest === latest) return;
			publish({ phase: "available", current, latest, subject });
		});
	};

	ipcMain.on("update:apply", () => {
		if (state.phase === "updating") return;
		const before = state;
		publish({ ...before, phase: "updating" });
		spawn("systemd-run", ["--user", "--quiet", "--collect", `--unit=${UNIT}`, script], { cwd: repo, detached: true, stdio: "ignore" }).unref();
		// On success the script stops this app, so all that needs watching is the unit ending while the app is still here.
		const watch = setInterval(() => {
			execFile("systemctl", ["--user", "is-active", UNIT], (_error, stdout) => {
				if (stdout.trim() === "active" || stdout.trim() === "activating") return;
				clearInterval(watch);
				publish({ ...before, phase: "failed" });
			});
		}, 5000);
	});

	setTimeout(check, FIRST_CHECK_MS);
	setInterval(check, CHECK_EVERY_MS);
}
