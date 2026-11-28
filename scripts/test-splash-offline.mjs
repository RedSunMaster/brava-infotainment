import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../src/hooks/useSplash.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
test("splash has a deadline when the map never loads", () => {
 const effects = [];
 const timers = [];
 const splash = {querySelector: () => null, classList: {add: () => {}}, remove: () => {}};
 const module = {exports: {}};
 const require = name => name === "react" ? {useEffect: fn => effects.push(fn)} : "loop";
 const window = {matchMedia: () => ({matches: true}), setTimeout: (fn, delay) => {timers.push({fn, delay}); return timers.length;}, clearTimeout: () => {}};
 new Function("require", "module", "exports", "window", "document", "performance", js)(require, module, module.exports, window, {getElementById: () => splash}, {now: () => 0});
 module.exports.useSplash(false);
 effects[1]();
 assert.equal(timers[0].delay, 8000);
});
