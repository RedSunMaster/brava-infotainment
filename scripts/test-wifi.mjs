import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../src/wifiMain.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", js)((name) => name === "electron" ? { ipcMain: {} } : {}, module, module.exports);
test("Wi-Fi scan fields preserve escaped colons and backslashes", () => {
 assert.deepEqual(module.exports.fields(String.raw`*:My\:network\\name:80:WPA2`), ["*", "My:network\\name", "80", "WPA2"]);
});
