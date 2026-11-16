// The ?url imports are resolved by a webpack rule (see webpack.rules.ts), which eslint cannot follow.
// eslint-disable-next-line import/no-unresolved
import workerUrl from "../voice/kokoro.worker.js?url";
// eslint-disable-next-line import/no-unresolved
import kokoroModuleUrl from "../../node_modules/kokoro-js/dist/kokoro.web.js?url";

/**
 * Natural-sounding spoken guidance using the Kokoro model, running locally.
 *
 * The model is downloaded once (about 90 MB) and cached by the browser, then
 * works offline. Until it is ready, or if it fails, callers fall back to the
 * system voice, so guidance is never silent because of this module.
 */

/** British English voices: bf_emma, bf_isabella, bf_alice, bf_lily, bm_george, bm_fable, bm_lewis, bm_daniel. */
const VOICE = "bf_emma";
const CACHE_LIMIT = 40;

export type KokoroStatus = "idle" | "loading" | "ready" | "failed";

let status: KokoroStatus = "idle";
let failure: string | null = null;
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (buffer: AudioBuffer | null) => void>();
const cache = new Map<string, Promise<AudioBuffer | null>>();
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

function setStatus(next: KokoroStatus, error: string | null = null) {
	status = next;
	failure = error;
	listeners.forEach((listener) => listener());
}

function audioContext(): AudioContext {
	context ??= new AudioContext();
	return context;
}

function fail(error: string) {
	console.warn("[voice] Kokoro unavailable, using the system voice:", error);
	pending.forEach((resolve) => resolve(null));
	pending.clear();
	cache.clear();
	worker?.terminate();
	worker = null;
	setStatus("failed", error);
}

export const kokoroVoice = {
	get status(): KokoroStatus {
		return status;
	},
	get error(): string | null {
		return failure;
	},
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},

	/** Starts loading the model. Safe to call repeatedly. */
	load(): void {
		if (status !== "idle") return;
		setStatus("loading");
		try {
			worker = new Worker(workerUrl, { type: "module" });
		} catch (error) {
			fail(error instanceof Error ? error.message : String(error));
			return;
		}
		worker.onerror = (event) => fail(event.message || "Voice worker failed to start.");
		worker.onmessage = ({ data }) => {
			if (data.type === "ready") setStatus("ready");
			else if (data.type === "failed") fail(data.error);
			else if (data.type === "audio") {
				const buffer = audioContext().createBuffer(1, data.samples.length, data.sampleRate);
				buffer.copyToChannel(data.samples, 0);
				pending.get(data.id)?.(buffer);
				pending.delete(data.id);
			} else if (data.type === "error") {
				pending.get(data.id)?.(null);
				pending.delete(data.id);
			}
		};
		worker.postMessage({
			type: "init",
			// Absolute, because the worker resolves imports against its own URL.
			moduleUrl: new URL(kokoroModuleUrl, window.location.href).href,
			voice: VOICE,
		});
	},

	/**
	 * Generates (or reuses) the audio for a phrase. Call ahead of time for
	 * phrases that will be needed soon so they play without delay.
	 */
	prepare(text: string): Promise<AudioBuffer | null> {
		const activeWorker = worker;
		if (!activeWorker || status === "failed" || status === "idle") return Promise.resolve(null);
		const cached = cache.get(text);
		if (cached) return cached;
		const id = ++nextId;
		const request = new Promise<AudioBuffer | null>((resolve) => {
			pending.set(id, resolve);
			activeWorker.postMessage({ type: "speak", id, text });
		});
		cache.set(text, request);
		// A failed phrase is retried next time rather than staying cached as silence.
		void request.then((buffer) => {
			if (!buffer && cache.get(text) === request) cache.delete(text);
		});
		if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
		return request;
	},

	/** Audio for a phrase, or null if it is not available within the time limit. */
	audioFor(text: string, timeoutMs: number): Promise<AudioBuffer | null> {
		if (status !== "ready") return Promise.resolve(null);
		return Promise.race([
			this.prepare(text),
			new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
		]);
	},

	play(buffer: AudioBuffer): void {
		this.stop();
		const output = audioContext();
		void output.resume();
		const source = output.createBufferSource();
		source.buffer = buffer;
		source.connect(output.destination);
		source.onended = () => {
			if (playing === source) playing = null;
		};
		source.start();
		playing = source;
	},

	stop(): void {
		try {
			playing?.stop();
		} catch {
			/* Already finished. */
		}
		playing = null;
	},
};
