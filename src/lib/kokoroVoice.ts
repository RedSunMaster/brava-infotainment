// The ?url imports are resolved by a webpack rule (see webpack.rules.ts), which eslint cannot follow.
// eslint-disable-next-line import/no-unresolved
import workerUrl from "../voice/kokoro.worker.js?url";
// eslint-disable-next-line import/no-unresolved
import kokoroModuleUrl from "../../node_modules/kokoro-js/dist/kokoro.web.js?url";
import { VoiceQueue } from "./voiceQueue";

/**
 * Natural-sounding spoken guidance using the Kokoro model, running locally.
 *
 * The model runs on the GPU when there is one and on the CPU otherwise. It is
 * downloaded once and cached by the browser, then works offline. Until it is ready,
 * or if it fails, callers fall back to the system voice, so guidance is never silent
 * because of this module.
 */

/** British English voices: bf_emma, bf_isabella, bf_alice, bf_lily, bm_george, bm_fable, bm_lewis, bm_daniel. */
const VOICE = "bf_emma";
const CACHE_LIMIT = 80;
/** Waiting for an unprepared phrase beyond this is worse than speaking it with the system voice. */
const URGENT = 0;
const BACKGROUND = 10;

export type KokoroStatus = "idle" | "loading" | "ready" | "failed";
export type KokoroDevice = "webgpu" | "wasm";

interface Job { id: number; text: string }

let status: KokoroStatus = "idle";
let failure: string | null = null;
let device: KokoroDevice | null = null;
let worker: Worker | null = null;
let nextId = 0;
let busy = false;
const queue = new VoiceQueue<Job>();
const pending = new Map<number, (buffer: AudioBuffer | null) => void>();
const cache = new Map<string, Promise<AudioBuffer | null>>();
const jobIds = new Map<string, number>();
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
let gain: GainNode | null = null;
let volume = 1;
let playing: AudioBufferSourceNode[] = [];

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
	console.warn("[voice] Natural voice unavailable, using the system voice:", error);
	pending.forEach((resolve) => resolve(null));
	pending.clear();
	cache.clear();
	jobIds.clear();
	queue.clear();
	busy = false;
	worker?.terminate();
	worker = null;
	device = null;
	setStatus("failed", error);
}

/** The model makes one clip at a time, so send the most urgent waiting phrase when it is free. */
function pump() {
	if (busy || !worker || status !== "ready") return;
	const job = queue.next();
	if (!job) return;
	busy = true;
	worker.postMessage({ type: "speak", id: job.id, text: job.text });
}

function finish(id: number, buffer: AudioBuffer | null) {
	pending.get(id)?.(buffer);
	pending.delete(id);
	busy = false;
	pump();
}

export const kokoroVoice = {
	get status(): KokoroStatus {
		return status;
	},
	get error(): string | null {
		return failure;
	},
	/** Where the model is running once ready: the GPU (fast) or the CPU (slower than real time). */
	get device(): KokoroDevice | null {
		return device;
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
			if (data.type === "ready") {
				device = data.device === "webgpu" ? "webgpu" : "wasm";
				console.info(`[voice] Natural voice ready on the ${device === "webgpu" ? "GPU" : "CPU"}`);
				setStatus("ready");
				pump();
			} else if (data.type === "failed") fail(data.error);
			else if (data.type === "audio") {
				const buffer = audioContext().createBuffer(1, data.samples.length, data.sampleRate);
				buffer.copyToChannel(data.samples, 0);
				finish(data.id, buffer);
			} else if (data.type === "error") finish(data.id, null);
		};
		worker.postMessage({
			type: "init",
			// Absolute, because the worker resolves imports against its own URL.
			moduleUrl: new URL(kokoroModuleUrl, window.location.href).href,
			voice: VOICE,
		});
	},

	/**
	 * Generates (or reuses) the audio for a phrase. Lower `priority` is made sooner; call ahead
	 * of time with a background priority for phrases that will be needed soon.
	 */
	prepare(text: string, priority = BACKGROUND): Promise<AudioBuffer | null> {
		if (!worker || status === "failed" || status === "idle") return Promise.resolve(null);
		const cached = cache.get(text);
		if (cached) {
			const id = jobIds.get(text);
			if (id != null) queue.promote(job => job.id === id, priority);
			return cached;
		}
		const id = ++nextId;
		const request = new Promise<AudioBuffer | null>((resolve) => {
			pending.set(id, resolve);
			queue.push({ id, text }, priority);
		});
		cache.set(text, request);
		jobIds.set(text, id);
		pump();
		// A failed phrase is retried next time rather than staying cached as silence.
		void request.then((buffer) => {
			jobIds.delete(text);
			if (!buffer && cache.get(text) === request) cache.delete(text);
		});
		if (cache.size > CACHE_LIMIT) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined && !jobIds.has(oldest)) cache.delete(oldest);
		}
		return request;
	},

	/** Prepares phrases in order in the background, earliest first. */
	prepareAll(texts: string[]): void {
		texts.forEach((text, index) => void this.prepare(text, BACKGROUND + index));
	},

	/** True if the phrase is already made, so it can be played with no delay. */
	has(text: string): boolean {
		return cache.has(text) && !jobIds.has(text);
	},

	/** Audio for a phrase, or null if it is not available within the time limit. */
	audioFor(text: string, timeoutMs: number): Promise<AudioBuffer | null> {
		if (status !== "ready") return Promise.resolve(null);
		return Promise.race([
			this.prepare(text, URGENT),
			new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
		]);
	},

	/** Loudness of the natural voice, 0 to 1. Takes effect immediately, even mid-sentence. */
	setVolume(next: number): void {
		volume = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 1));
		if (gain) gain.gain.value = volume;
	},

	/**
	 * Plays clips one after another with no audible gap, starting `leadSeconds` from now.
	 * Resolves when the last clip has finished, or when it is cut short by `stop()`.
	 */
	play(buffers: AudioBuffer[], leadSeconds = 0.02): Promise<void> {
		this.stop();
		const output = audioContext();
		void output.resume();
		if (!gain) {
			gain = output.createGain();
			gain.connect(output.destination);
		}
		gain.gain.value = volume;
		let at = output.currentTime + leadSeconds;
		if (!buffers.length) return Promise.resolve();
		return new Promise<void>((resolve) => {
			buffers.forEach((buffer, index) => {
				const source = output.createBufferSource();
				source.buffer = buffer;
				source.connect(gain!);
				source.onended = () => {
					playing = playing.filter((item) => item !== source);
					if (index === buffers.length - 1) resolve();
				};
				source.start(at);
				playing.push(source);
				at += buffer.duration + 0.03;
			});
		});
	},

	stop(): void {
		for (const source of playing) {
			try {
				source.stop();
			} catch {
				/* Already finished. */
			}
		}
		playing = [];
	},
};
