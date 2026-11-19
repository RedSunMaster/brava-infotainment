// A stand-in for the car side, for developing the Android app without running the whole Electron app.
// Usage: node tools/phone-receiver.mjs [port]     (then: adb reverse tcp:PORT tcp:PORT)
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import ts from "typescript";
const src = readFileSync(new URL("../src/lib/phoneLink.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const { parsePhoneMessage, createLineSplitter, frame } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const port = Number(process.argv[2]) || 8765;
createServer((socket) => {
	console.log("phone connected");
	socket.setEncoding("utf8");
	socket.on("data", createLineSplitter((line) => {
		const m = parsePhoneMessage(line);
		if (!m) return console.log("ignored:", line.slice(0, 120));
		console.log(JSON.stringify(m));
		if (m.t === "ping") socket.write(frame({ t: "pong" }));
	}));
	socket.on("close", () => console.log("phone disconnected"));
	socket.on("error", () => socket.destroy());
}).listen(port, "127.0.0.1", () => console.log(`listening on 127.0.0.1:${port}`));
