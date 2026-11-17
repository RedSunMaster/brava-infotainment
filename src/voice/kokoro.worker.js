// Kokoro text-to-speech, run in a module worker.
//
// This file is emitted as-is (imported with ?url), not bundled. A worker has no
// Node integration, so the Kokoro browser build sees a plain web environment,
// and speech generation stays off the UI thread.
//
// The model runs on the GPU (WebGPU) when there is one, which is roughly ten times
// faster than real time. Without a usable GPU it falls back to the CPU (WebAssembly),
// which is slower than real time, so the app prepares phrases ahead of time.
//
// Messages in:  { type: "init", moduleUrl, voice }
//               { type: "speak", id, text }
// Messages out: { type: "ready", device } | { type: "failed", error }
//               { type: "audio", id, samples, sampleRate } | { type: "error", id, error }

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Tried in order. fp32 is the format WebGPU runs reliably; q8 is the smallest (~90 MB)
// and fastest on a CPU.
const ATTEMPTS = [
	{ device: "webgpu", dtype: "fp32" },
	{ device: "wasm", dtype: "q8" },
];

let voice = "bf_emma";
let ready = null;

async function load(moduleUrl) {
	const { KokoroTTS } = await import(moduleUrl);
	const problems = [];
	for (const attempt of ATTEMPTS) {
		try {
			if (attempt.device === "webgpu") {
				if (!self.navigator?.gpu) throw new Error("WebGPU is not available");
				if (!(await self.navigator.gpu.requestAdapter())) throw new Error("no WebGPU adapter");
			}
			const tts = await KokoroTTS.from_pretrained(MODEL_ID, attempt);
			// A first clip compiles the GPU programs and proves the backend really works.
			await tts.generate("Ready.", { voice });
			return { tts, device: attempt.device };
		} catch (error) {
			problems.push(`${attempt.device}: ${String(error?.message ?? error)}`);
		}
	}
	throw new Error(problems.join("; "));
}

self.onmessage = async ({ data }) => {
	if (data.type === "init") {
		voice = data.voice ?? voice;
		ready = load(data.moduleUrl);
		try {
			const { device } = await ready;
			self.postMessage({ type: "ready", device });
		} catch (error) {
			self.postMessage({ type: "failed", error: String(error?.message ?? error) });
		}
		return;
	}
	if (data.type === "speak") {
		try {
			const { tts } = await ready;
			const audio = await tts.generate(data.text, { voice });
			const samples = audio.audio;
			self.postMessage(
				{ type: "audio", id: data.id, samples, sampleRate: audio.sampling_rate },
				[samples.buffer],
			);
		} catch (error) {
			self.postMessage({ type: "error", id: data.id, error: String(error?.message ?? error) });
		}
	}
};
