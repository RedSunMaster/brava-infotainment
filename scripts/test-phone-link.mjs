import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const load = async name => {
	const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
	const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
};
const { parsePhoneMessage, createLineSplitter, createNotificationStore, frame, timeAgo, spokenNotification } = await load("lib/phoneLink");
const { createPhoneSettings, readPhoneSettings } = await load("lib/phoneSettings");
const memory = (data = {}) => ({ data, getItem(k) { return k in data ? data[k] : null; }, setItem(k, v) { data[k] = String(v); } });
const notif = (extra = {}) => ({ t: "notif", key: "k1", app: "com.msg", appName: "Messages", title: "Sam", text: "Running late", sender: "Sam", kind: "message", time: 1000, ...extra });

test("a message notification is read in full", () => {
	assert.deepEqual(parsePhoneMessage(JSON.stringify(notif()), 5000), { ...notif(), conversation: null });
});
test("junk, unknown types and missing keys are refused", () => {
	for (const line of ["", "nope", "[]", "null", '{"t":"unknown"}', '{"t":"notif"}', '{"t":"gone"}', '{"t":"hello"}', '{"t":"hello","v":0}']) assert.equal(parsePhoneMessage(line), null, line);
});
test("text is cleaned and cut, and a wrong clock cannot put a notification in the future", () => {
	const m = parsePhoneMessage(JSON.stringify(notif({ title: "a\u0000b" + "x".repeat(500), time: 99999 })), 5000);
	assert.equal(m.title.startsWith("ab"), true);
	assert.equal(m.title.length, 200);
	assert.equal(m.time, 5000);
});
test("an unknown kind is treated as other", () => {
	assert.equal(parsePhoneMessage(JSON.stringify(notif({ kind: "weird" })), 5000).kind, "other");
});
test("the line splitter joins chunks, handles CRLF and skips overlong lines", () => {
	const lines = [];
	const feed = createLineSplitter((l) => lines.push(l), 20);
	feed('{"a":1}\r\n{"b"');
	feed(':2}\n\n');
	feed("x".repeat(50));
	feed("y".repeat(10) + "\n" + '{"c":3}\n');
	assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});
test("the store keeps newest first, updates by key, counts unread and removes", () => {
	const store = createNotificationStore({ max: 3 });
	store.add({ ...notif({ key: "a", time: 1 }) });
	store.add({ ...notif({ key: "b", time: 3 }) });
	store.add({ ...notif({ key: "a", time: 2, text: "edited" }) });
	assert.deepEqual(store.get().items.map((i) => [i.key, i.text]), [["b", "Running late"], ["a", "edited"]]);
	assert.equal(store.get().unread, 2);
	store.markAllRead();
	assert.equal(store.get().unread, 0);
	store.remove("b");
	assert.equal(store.get().items.length, 1);
	for (const k of ["c", "d", "e"]) store.add(notif({ key: k, time: 10 }));
	assert.equal(store.get().items.length, 3);
});
test("only allowed apps get in", () => {
	const store = createNotificationStore({ isAllowed: (app) => app === "com.msg" });
	assert.ok(store.add(notif()));
	assert.equal(store.add(notif({ key: "z", app: "com.game" })), null);
});
test("messages to the phone are one line", () => {
	assert.equal(frame({ t: "dismiss", key: "k" }), '{"t":"dismiss","key":"k"}\n');
});

test("time ago is short", () => {
	const now = 10 * 3_600_000;
	assert.equal(timeAgo(now - 20_000, now), "now");
	assert.equal(timeAgo(now - 5 * 60_000, now), "5 min");
	assert.equal(timeAgo(now - 3 * 3_600_000, now), "3 h");
	assert.equal(timeAgo(now + 60_000, now), "now");
});
test("what is read aloud: who, where, and no links or pictures", () => {
	assert.equal(spokenNotification(notif({ text: "Running late 😀 see https://x.co/a" })), "Message from Sam: Running late see a link");
	assert.equal(spokenNotification(notif({ conversation: "Family", sender: "Sam" })), "Message from Sam in Family: Running late");
	assert.equal(spokenNotification(notif({ conversation: "Sam", sender: "Sam" })), "Message from Sam: Running late");
	assert.equal(spokenNotification(notif({ kind: "other", appName: "Calendar", title: "Dentist", text: "3 pm" })), "Calendar: Dentist. 3 pm");
	assert.equal(spokenNotification(notif({ text: "", sender: null, title: "" })), "Message from Someone.");
});
test("phone settings default sensibly, survive bad data, and remember apps", () => {
	assert.deepEqual(readPhoneSettings(memory({ "brava-phone-settings": "garbage" })), { toasts: true, showText: true, blocked: [], apps: {} });
	const store = memory();
	const settings = createPhoneSettings(store);
	settings.setShowText(false);
	settings.noteApp("com.game", "Game");
	settings.setBlocked("com.game", true);
	assert.equal(settings.isAllowed("com.game"), false);
	const again = createPhoneSettings(store).get();
	assert.deepEqual([again.showText, again.blocked, again.apps], [false, ["com.game"], { "com.game": "Game" }]);
	settings.setBlocked("com.game", false);
	assert.equal(settings.isAllowed("com.game"), true);
});
