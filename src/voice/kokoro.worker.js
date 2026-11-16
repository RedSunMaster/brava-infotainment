// Kokoro text-to-speech, run in a module worker.
//
// This file is emitted as-is (imported with ?url), not bundled. A worker has no
// Node integration, so the Kokoro browser build sees a plain web environment,
// and speech generation stays off the UI thread.
//
// Messages in:  { type: "init", moduleUrl, voice }
//               { type: "speak", id, text }
// Messages out: { type: "ready" } | { type: "failed", error }
//               { type: "audio", id, samples, sampleRate } | { type: "error", id, error }

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let voice = "bf_emma";
let tts = null;

self.onmessage = async ({ data }) => {
	if (data.type === "init") {
		voice = data.voice ?? voice;
		tts = (async () => {
			const { KokoroTTS } = await import(data.moduleUrl);
			// q8 is the smallest model (~90 MB, downloaded once and cached) and
			// the fastest on a CPU.
			return KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm" });
		})();
		try {
			await tts;
			self.postMessage({ type: "ready" });
		} catch (error) {
			self.postMessage({ type: "failed", error: String(error?.message ?? error) });
		}
		return;
	}
	if (data.type === "speak") {
		try {
			const audio = await (await tts).generate(data.text, { voice });
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
