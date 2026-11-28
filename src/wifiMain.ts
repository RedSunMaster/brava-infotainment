import { execFile, spawn } from "node:child_process";
import { ipcMain } from "electron";

function nm(args: string[]): Promise<string | null> {
 return new Promise(resolve => execFile("nmcli", args, { timeout: 15000, env: { ...process.env, LC_ALL: "C" } }, (error, out) => resolve(error ? null : out)));
}
// nmcli escapes colons and backslashes in its terse output.
export function fields(line: string): string[] {
 const parts = [""]; let escaped = false;
 for (const c of line) { if (escaped) { parts[parts.length - 1] += c; escaped = false; } else if (c === "\\") escaped = true; else if (c === ":") parts.push(""); else parts[parts.length - 1] += c; }
 return parts;
}
export function registerWifiIpc() {
 ipcMain.handle("wifi:state", async () => {
  if (process.platform !== "linux") return { error: "Wi-Fi settings are only available on the car computer.", networks: [] };
  const output = await nm(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "no"]);
  if (output === null) return { error: "Wi-Fi is unavailable. Check NetworkManager.", networks: [] };
  const networks: { ssid: string; signal: number; security: string; connected: boolean }[] = [];
  for (const line of output.split("\n")) {
   const [active, ssid, signal, security] = fields(line);
   if (!ssid || networks.some(n => n.ssid === ssid)) continue;
   networks.push({ ssid, signal: Number(signal) || 0, security: security || "", connected: active === "*" });
  }
  return { error: null, networks };
 });
 ipcMain.handle("wifi:scan", async () => (await nm(["device", "wifi", "rescan"])) !== null);
 ipcMain.handle("wifi:connect", async (_event, ssid: unknown, password: unknown) => {
  if (process.platform !== "linux" || typeof ssid !== "string" || !ssid || ssid.length > 128 || typeof password !== "string" || password.length > 128 || /[\r\n]/.test(password)) return { ok: false, message: "Invalid network or password." };
  return await new Promise(resolve => {
   const args = password ? ["--passwd-file", "/dev/stdin", "device", "wifi", "connect", ssid] : ["device", "wifi", "connect", ssid];
   const child = spawn("nmcli", args, { env: { ...process.env, LC_ALL: "C" }, stdio: ["pipe", "ignore", "pipe"] });
   let err = ""; child.stderr.on("data", data => { err += data; });
   const timer = setTimeout(() => child.kill(), 45000);
   child.on("error", () => { clearTimeout(timer); resolve({ ok: false, message: "Could not start NetworkManager." }); });
   child.on("close", code => { clearTimeout(timer); resolve({ ok: code === 0, message: code === 0 ? "Connected." : (err.trim() || "Could not connect.") }); });
   child.stdin.on("error", () => undefined);
   child.stdin.end(password ? `802-11-wireless-security.psk:${password}\n` : "");
  });
 });
}
