import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EventEmitter } from "node:events";
import ts from "typescript";
const source = readFileSync(new URL("../src/wifiMain.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", js)((name) => name === "electron" ? { ipcMain: {} } : {}, module, module.exports);
test("Wi-Fi scan fields preserve escaped colons and backslashes", () => {
 assert.deepEqual(module.exports.fields(String.raw`*:My\:network\\name:80:WPA2`), ["*", "My:network\\name", "80", "WPA2"]);
});

test("Wi-Fi connects with a password and disconnects without deleting the profile", async () => {
 const handlers = {};
 const calls = [];
 const mock = { exports: {} };
 const require = name => name === "electron" ? { ipcMain: { handle: (key, fn) => { handlers[key] = fn; } } } : {
  execFile: (_cmd, args, _options, cb) => { calls.push(args); cb(null, args.includes("status") ? "wlan0:wifi:connected\n" : ""); },
  spawn: (_cmd, args) => {
   calls.push(args);
   const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
   child.stdin.end = () => process.nextTick(() => child.emit("close", 0)); child.kill = () => {};
   return child;
  },
 };
 new Function("require", "module", "exports", "process", js)(require, mock, mock.exports, { platform: "linux", env: {} });
 mock.exports.registerWifiIpc();
 assert.equal((await handlers["wifi:connect"]({}, "My network", "a:b password")).ok, true);
 assert.equal((await handlers["wifi:disconnect"]()).ok, true);
 assert.deepEqual(calls[0], ["device", "wifi", "connect", "My network", "password", "a:b password"]);
 assert.deepEqual(calls[2], ["device", "disconnect", "wlan0"]);
});

test("Bluetooth tethering lists PAN profiles and routes, and rejects other profiles", async () => {
 const handlers = {};
 const outputs = new Map([
  ["-t -f NAME,UUID,TYPE,DEVICE connection show", "Pixel:88fc1531-f0d5-4716-b990-5052c5909b75:bluetooth:08\\:8B\\:C8\\:5D\\:68\\:8A\n"],
  ["-g bluetooth.type connection show uuid 88fc1531-f0d5-4716-b990-5052c5909b75", "panu\n"],
  ["-g GENERAL.DEFAULT connection show uuid 88fc1531-f0d5-4716-b990-5052c5909b75", "no\n"],
  ["-g connection.type,bluetooth.type connection show uuid 88fc1531-f0d5-4716-b990-5052c5909b75", "bluetooth\ndun\n"],
 ]);
 const mock = { exports: {} };
 const require = name => name === "electron" ? { ipcMain: { handle: (key, fn) => { handlers[key] = fn; } } } : { execFile: (_cmd, args, _options, cb) => cb(null, outputs.get(args.join(" ")) ?? "") };
 new Function("require", "module", "exports", "process", js)(require, mock, mock.exports, { platform: "linux", env: {} });
 mock.exports.registerWifiIpc();
 const state = await handlers["tether:state"]();
 assert.deepEqual(state.connections, [{ name: "Pixel", uuid: "88fc1531-f0d5-4716-b990-5052c5909b75", connected: true, preferred: false }]);
 assert.equal((await handlers["tether:action"]({}, "88fc1531-f0d5-4716-b990-5052c5909b75", true)).ok, false);
});
