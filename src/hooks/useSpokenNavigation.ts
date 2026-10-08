import { useCallback, useEffect, useRef, useState } from "react";
export function useSpokenNavigation(instruction: string, distance: number | null, active: boolean) {
	const [muted, setMuted] = useState(() => localStorage.getItem("brava-guidance-muted") === "true");
	const lastAnnouncement = useRef("");
	const supported = "speechSynthesis" in window;
	const speak = useCallback(() => {
		if (!supported || !active || !instruction) return;
		window.speechSynthesis.cancel();
		const prefix = distance != null && distance > 30 ? `In ${Math.round(distance / 10) * 10} metres, ` : "";
		const utterance = new SpeechSynthesisUtterance(prefix + instruction);
		utterance.lang = "en-NZ";
		window.speechSynthesis.speak(utterance);
	}, [supported, active, instruction, distance]);
	useEffect(() => {
		localStorage.setItem("brava-guidance-muted", String(muted));
		if (!active || muted) {
			if (supported) window.speechSynthesis.cancel();
			if (!active) lastAnnouncement.current = "";
			return;
		}
		const stage = distance != null && distance <= 80 ? "near" : "advance";
		const key = `${instruction}:${stage}`;
		if (instruction && key !== lastAnnouncement.current) { lastAnnouncement.current = key; speak(); }
	}, [instruction, distance, active, muted, supported, speak]);
	useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);
	return { muted, supported, speak, toggleMute: () => setMuted((value) => !value) };
}
