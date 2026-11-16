import { useCallback, useEffect, useRef, useState } from "react";
import { kokoroVoice } from "../lib/kokoroVoice";

// How long to wait for the Kokoro voice before using the system voice instead.
const KOKORO_TIMEOUT_MS = 5000;
// Below this distance the instruction is spoken on its own, with no "In … metres".
const NEAR_METRES = 80;

function systemSpeak(text: string) {
	if (!("speechSynthesis" in window)) return;
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = "en-NZ";
	window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
	kokoroVoice.stop();
	if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function useSpokenNavigation(instruction: string, distance: number | null, active: boolean) {
	const [muted, setMuted] = useState(() => localStorage.getItem("brava-guidance-muted") === "true");
	const lastAnnouncement = useRef("");
	const request = useRef(0);
	const supported = true;

	// Load the Kokoro voice shortly after startup so it is ready before the first trip.
	useEffect(() => {
		const timer = window.setTimeout(() => kokoroVoice.load(), 4000);
		return () => window.clearTimeout(timer);
	}, []);

	// Generate the plain instruction as soon as it is known, so the close-range
	// announcement plays without delay.
	useEffect(() => {
		if (active && instruction) void kokoroVoice.prepare(instruction);
	}, [active, instruction]);

	const say = useCallback(async (text: string) => {
		const token = ++request.current;
		stopSpeaking();
		const audio = await kokoroVoice.audioFor(text, KOKORO_TIMEOUT_MS);
		// A newer announcement (or mute) has replaced this one while it was generating.
		if (token !== request.current) return;
		if (audio) kokoroVoice.play(audio);
		else systemSpeak(text);
	}, []);

	const speak = useCallback(() => {
		if (!active || !instruction) return;
		const prefix = distance != null && distance > NEAR_METRES ? `In ${Math.round(distance / 10) * 10} metres, ` : "";
		void say(prefix + instruction);
	}, [active, instruction, distance, say]);

	useEffect(() => {
		localStorage.setItem("brava-guidance-muted", String(muted));
		if (!active || muted) {
			request.current++;
			stopSpeaking();
			if (!active) lastAnnouncement.current = "";
			return;
		}
		const stage = distance != null && distance <= NEAR_METRES ? "near" : "advance";
		const key = `${instruction}:${stage}`;
		if (instruction && key !== lastAnnouncement.current) { lastAnnouncement.current = key; speak(); }
	}, [instruction, distance, active, muted, speak]);

	useEffect(() => () => { request.current++; stopSpeaking(); }, []);

	return { muted, supported, speak, toggleMute: () => setMuted((value) => !value) };
}
