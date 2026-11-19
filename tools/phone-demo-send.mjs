// Plays the phone for the running Brava app, to see the notification UI without a phone.
// Start the app with BRAVA_PHONE_TCP_PORT=8765, then: node tools/phone-demo-send.mjs [port]
import { createConnection } from "node:net";
const port = Number(process.argv[2]) || 8765;
const now = Date.now();
const lines = [
	{ t: "hello", v: 1, device: "Pixel 9" },
	{ t: "notif", key: "a", app: "com.google.android.apps.messaging", appName: "Messages", title: "Sam", text: "Running about ten minutes late, can you start without me? Save me a seat 😀", sender: "Sam", kind: "message", time: now - 120_000 },
	{ t: "notif", key: "b", app: "com.whatsapp", appName: "WhatsApp", title: "Family", text: "Mum: Dinner is at 6 on Sunday", sender: "Mum", conversation: "Family", kind: "message", time: now - 3_600_000 },
	{ t: "notif", key: "c", app: "com.google.android.calendar", appName: "Calendar", title: "Dentist", text: "Tomorrow 3:00 pm", kind: "other", time: now - 9_000_000 },
];
const socket = createConnection(port, "127.0.0.1", () => {
	lines.forEach((line, index) => setTimeout(() => socket.write(JSON.stringify(line) + "\n"), index * 700));
	setTimeout(() => socket.write(JSON.stringify({ t: "notif", key: "d", app: "com.google.android.apps.messaging", appName: "Messages", title: "Alex", text: "Are you coming tonight?", sender: "Alex", kind: "message", time: Date.now() }) + "\n"), lines.length * 700 + 500);
	console.log("sent; leaving the link open (Ctrl+C to drop it)");
});
socket.on("error", (e) => { console.error("could not connect:", e.message); process.exit(1); });
socket.setEncoding("utf8");
socket.on("data", (d) => process.stdout.write("car: " + d));
