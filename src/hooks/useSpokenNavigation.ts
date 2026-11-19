import { useCallback, useEffect, useRef, useState } from "react";
import { kokoroVoice } from "../lib/kokoroVoice";
import { masterVolume, voiceLevels } from "./useMasterVolume";
import { appScale } from "../lib/masterVolume";
import type { VoiceKind } from "../lib/voiceLevels";
import { audioDucking, DUCK_LEAD_S } from "../lib/audioDucking";
import { announcementParts, type GuidanceStep, type Stage } from "../lib/spokenGuidance";
import { toSpeech } from "../lib/spokenText";
import { bandFor, quietForNotice, shouldAnnounce, thresholds, type Band } from "../lib/announceTiming";

export type { GuidanceStep } from "../lib/spokenGuidance";

// How long to wait for the natural voice to make a phrase that was not prepared in time
// before using the system voice. The GPU makes a phrase in well under a second.
const WAIT_GPU_MS = 3500;
const WAIT_CPU_MS = 4500;
/** How many manoeuvres ahead are prepared in the background. */
const PREPARE_AHEAD = 5;

export type VoiceEngine = "natural" | "system";

function systemSpeak(text: string, volume: number) {
	if (!("speechSynthesis" in window)) return;
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = "en-NZ";
	utterance.volume = volume;
	const release = audioDucking.begin();
	utterance.onend = release;
	utterance.onerror = release;
	window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
	kokoroVoice.stop();
	if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function readEngine(): VoiceEngine {
	try {
		return localStorage.getItem("brava-voice-engine") === "system" ? "system" : "natural";
	} catch {
		return "natural";
	}
}

/**
 * Speaks turn guidance. `steps[0]` is the manoeuvre ahead and the rest follow it: they are prepared
 * in the background as soon as the route is known, so each is ready before it is needed.
 */
export function useSpokenNavigation(steps: GuidanceStep[], distance: number | null, active: boolean, speedMs = 0) {
	const [muted, setMuted] = useState(() => localStorage.getItem("brava-guidance-muted") === "true");
	const [engine, setEngineState] = useState<VoiceEngine>(readEngine);
	// Which kind of prompt is being spoken now, so a volume change mid-sentence moves the right one.
	const speakingKind = useRef<VoiceKind>("guidance");
	// The last stage spoken for the turn ahead, so each stage is said once as the car closes in.
	const lastSpoken = useRef<{ key: string; band: Band } | null>(null);
	const lastTurnSpokenAt = useRef(0);
	// A notice (closure, faster route) waiting for a quiet moment, so it never talks over a turn.
	const pendingNotice = useRef<{ text: string; expires: number } | null>(null);
	const speedRef = useRef(speedMs);
	speedRef.current = speedMs;
	const request = useRef(0);
	// Set while a closing message ("You have arrived") plays after guidance has already stopped.
	const finishing = useRef(false);
	const distanceRef = useRef(distance);
	distanceRef.current = distance;
	const supported = true;

	const setEngine = useCallback((next: VoiceEngine) => {
		setEngineState(next);
		try { localStorage.setItem("brava-voice-engine", next); } catch { /* Keep the choice for this session. */ }
	}, []);

	/** How loud a prompt of this kind is right now: its own level, under the master volume where the app has to apply that itself. */
	const levelFor = (kind: VoiceKind) => voiceLevels.get()[kind] * appScale(masterVolume.get());
	useEffect(() => {
		const apply = () => kokoroVoice.setVolume(levelFor(speakingKind.current));
		apply();
		const stops = [voiceLevels.subscribe(apply), masterVolume.subscribe(apply)];
		return () => stops.forEach((stop) => stop());
	}, []);

	// Load the natural voice shortly after startup so it is ready before the first trip.
	useEffect(() => {
		if (engine !== "natural") return;
		const timer = window.setTimeout(() => kokoroVoice.load(), 2000);
		return () => window.clearTimeout(timer);
	}, [engine]);

	// Make the phrases for the next few manoeuvres ahead of time, nearest first, in both the
	// "In 300 metres, …" and the close-up form.
	useEffect(() => {
		if (!active || engine !== "natural" || !steps.length) return;
		kokoroVoice.load();
		const phrases: string[] = [];
		for (let i = 0; i < Math.min(PREPARE_AHEAD, steps.length); i++) {
			const away = i === 0 ? distanceRef.current : steps[i - 1].lengthM;
			// The reminder part-way along says a rounder, shorter distance than the first announcement.
			const reminder = away == null ? null : Math.min(away, thresholds(speedRef.current).reminder);
			phrases.push(...announcementParts(steps, i, "advance", away), ...announcementParts(steps, i, "advance", reminder), ...announcementParts(steps, i, "near", null));
		}
		kokoroVoice.prepareAll([...new Set(phrases.filter(Boolean))]);
	}, [active, engine, steps]);

	const say = useCallback(async (parts: string[], kind: VoiceKind = "guidance") => {
		const token = ++request.current;
		stopSpeaking();
		speakingKind.current = kind;
		kokoroVoice.setVolume(levelFor(kind));
		const text = parts.join(" ");
		if (engine === "natural" && kokoroVoice.status === "ready") {
			const wait = kokoroVoice.device === "webgpu" ? WAIT_GPU_MS : WAIT_CPU_MS;
			const started = performance.now();
			const clips = await Promise.all(parts.map((part) => kokoroVoice.audioFor(part, wait)));
			// A newer announcement (or mute) has replaced this one while it was being made.
			if (token !== request.current) return;
			if (clips.every((clip): clip is AudioBuffer => !!clip)) {
				console.info(`[voice] natural voice (${kokoroVoice.device === "webgpu" ? "GPU" : "CPU"}), ready after ${Math.round(performance.now() - started)} ms: ${text}`);
				const release = audioDucking.begin();
				void kokoroVoice.play(clips, DUCK_LEAD_S).finally(release);
				return;
			}
			console.info(`[voice] natural voice was not ready within ${wait} ms, using the system voice: ${text}`);
		} else if (engine === "natural") {
			console.info(`[voice] natural voice is ${kokoroVoice.status}, using the system voice: ${text}`);
		}
		systemSpeak(text, levelFor(kind));
	}, [engine]);

	// Speaks something other than a turn instruction, unless the driver has muted guidance.
	// Said when it will not talk over a turn; otherwise held for up to 30 seconds and said at the next quiet moment.
	const announce = useCallback((text: string) => {
		if (!active || muted) return;
		if (quietForNotice(distanceRef.current, Date.now() - lastTurnSpokenAt.current)) void say([toSpeech(text)], "alerts");
		else pendingNotice.current = { text, expires: Date.now() + 30_000 };
	}, [active, muted, say]);

	// A closing message, said as guidance ends (it would otherwise be cut off by that).
	const finish = useCallback((text: string) => {
		if (muted) return;
		finishing.current = true;
		void say([toSpeech(text)]);
	}, [muted, say]);

	// Plays a sample so the volume and voice can be judged from Settings, even when not navigating.
	const test = useCallback(() => { void say(["In 200 metres,", "Turn left onto Millstream Drive."]); }, [say]);

	// The same, for an alert, so its own volume can be judged.
	const testAlert = useCallback(() => { void say([toSpeech("There is a road closure on your route.")], "alerts"); }, [say]);

	// Says any text exactly as guidance would, for tuning pronunciation from the developer console.
	const sample = useCallback((text: string) => { void say(text.split(/(?<=[.!?])\s+/).map(toSpeech).filter(Boolean)); }, [say]);

	const speakFor = useCallback((stage: Stage) => {
		const parts = announcementParts(steps, 0, stage, distance);
		if (parts.length) { lastTurnSpokenAt.current = Date.now(); void say(parts); }
	}, [steps, distance, say]);

	const speak = useCallback(() => {
		if (!active) return;
		speakFor(distance != null && distance <= thresholds(speedRef.current).now ? "near" : "advance");
	}, [active, distance, speakFor]);

	useEffect(() => {
		localStorage.setItem("brava-guidance-muted", String(muted));
		if (active) finishing.current = false;
		if (!active || muted) {
			// Leave a closing message playing; everything else stops with guidance.
			if (!(finishing.current && !active && !muted)) {
				request.current++;
				stopSpeaking();
			}
			if (!active) { lastSpoken.current = null; pendingNotice.current = null; }
			return;
		}
		const current = steps[0];
		// Wait for the first distance reading, otherwise a trip that starts beside a turn announces it twice.
		if (!current || distance == null) return;
		const key = `${current.id}:${current.instruction}`;
		const first = lastSpoken.current?.key !== key;
		const band = bandFor(distance, speedRef.current, first);
		if (shouldAnnounce(band, first ? null : lastSpoken.current!.band)) {
			lastSpoken.current = { key, band };
			speakFor(band === "now" ? "near" : "advance");
			return;
		}
		// Nothing due for the turn: say a held notice if the road is quiet.
		const waiting = pendingNotice.current;
		if (waiting) {
			if (Date.now() > waiting.expires) pendingNotice.current = null;
			else if (quietForNotice(distance, Date.now() - lastTurnSpokenAt.current)) { pendingNotice.current = null; void say([toSpeech(waiting.text)], "alerts"); }
		}
	}, [steps, distance, active, muted, speakFor, say]);

	useEffect(() => () => { request.current++; stopSpeaking(); }, []);

	return { muted, supported, engine, setEngine, test, testAlert, speak, announce, finish, sample, toggleMute: () => setMuted((value) => !value) };
}
