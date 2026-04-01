import React, { useState, useCallback, useRef, RefObject } from "react";
import ReactDOM from "react-dom";
import { Box } from "@mui/material";

const NUM_ROW = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const QWERTY = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
const ASDF = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const ZXCV = ["z", "x", "c", "v", "b", "n", "m"];

// ── Mutation helpers ──────────────────────────────────────────────────────────

function setNativeValue(
	el: HTMLInputElement | HTMLTextAreaElement,
	value: string,
) {
	const proto =
		el instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertAtCursor(
	char: string,
	targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
) {
	const el = targetRef.current;
	if (!el) return;
	const s = el.selectionStart ?? el.value.length;
	const e = el.selectionEnd ?? el.value.length;
	const next = el.value.slice(0, s) + char + el.value.slice(e);
	setNativeValue(el, next);
	el.focus();
	el.setSelectionRange(s + char.length, s + char.length);
}

function deleteAtCursor(
	targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
) {
	const el = targetRef.current;
	if (!el) return;
	const s = el.selectionStart ?? el.value.length;
	const e = el.selectionEnd ?? el.value.length;
	let next: string;
	let pos: number;
	if (s !== e) {
		next = el.value.slice(0, s) + el.value.slice(e);
		pos = s;
	} else if (s > 0) {
		next = el.value.slice(0, s - 1) + el.value.slice(s);
		pos = s - 1;
	} else return;
	setNativeValue(el, next);
	el.focus();
	el.setSelectionRange(pos, pos);
}

// ── Key button ────────────────────────────────────────────────────────────────

type KeyVariant = "default" | "special" | "active";

interface KeyProps {
	id: string;
	label: React.ReactNode;
	onPress: () => void;
	flex?: number;
	variant?: KeyVariant;
	pressedKey: string | null;
	onPressStart: (id: string) => void;
	onPressEnd: () => void;
	// Optional long-press repeat handler (used by backspace only)
	onHold?: () => void;
}

function Key({
	id,
	label,
	onPress,
	flex = 1,
	variant = "default",
	pressedKey,
	onPressStart,
	onPressEnd,
	onHold,
}: KeyProps) {
	const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const startHold = () => {
		if (!onHold) return;
		holdTimerRef.current = setTimeout(() => {
			holdIntervalRef.current = setInterval(onHold, 80);
		}, 400);
	};

	const cancelHold = () => {
		if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
		if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
		holdTimerRef.current = null;
		holdIntervalRef.current = null;
	};

	const isPressed = pressedKey === id;

	const bg: Record<KeyVariant, string> = {
		default: "rgba(255,255,255,0.13)",
		special: "rgba(255,255,255,0.07)",
		active: "rgba(255,255,255,0.92)",
	};

	return (
		<Box
			component="button"
			onMouseDown={(e: React.MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				onPressStart(id);
				startHold();
			}}
			onMouseUp={(e: React.MouseEvent) => {
				e.preventDefault();
				cancelHold();
				onPressEnd();
				onPress();
			}}
			onMouseLeave={() => {
				cancelHold();
				onPressEnd();
			}}
			onTouchStart={(e: React.TouchEvent) => {
				e.preventDefault();
				e.stopPropagation();
				onPressStart(id);
				startHold();
			}}
			onTouchEnd={(e: React.TouchEvent) => {
				e.preventDefault();
				e.stopPropagation();
				cancelHold();
				onPressEnd();
				onPress();
			}}
			onTouchCancel={() => {
				cancelHold();
				onPressEnd();
			}}
			sx={{
				flex,
				minWidth: 0,
				height: 52,
				// Flash white when pressed, otherwise use variant colour
				background: isPressed ? "rgba(255,255,255,0.55)" : bg[variant],
				border: `1px solid ${isPressed ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.08)"}`,
				borderRadius: "8px",
				color:
					isPressed || variant === "active" ? "#111" : "rgba(255,255,255,0.9)",
				fontSize: typeof label === "string" && label.length === 1 ? 17 : 13,
				fontWeight: variant !== "default" ? 600 : 400,
				fontFamily: "inherit",
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitTapHighlightColor: "transparent",
				touchAction: "manipulation",
				// Slight scale-down when pressed for tactile feel
				transform: isPressed ? "scale(0.93)" : "scale(1)",
				transition: isPressed
					? "background 0.04s, transform 0.04s"
					: "background 0.12s, transform 0.12s",
				p: 0,
			}}
		>
			{label}
		</Box>
	);
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
	targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
	openedAtRef: RefObject<number>;
	onEnter?: () => void;
	onClose: () => void;
}

export default function InAppKeyboard({
	targetRef,
	openedAtRef,
	onEnter,
	onClose,
}: Props) {
	const [shifted, setShifted] = useState(false);
	// ID of the currently pressed key — drives the press flash
	const [pressedKey, setPressedKey] = useState<string | null>(null);

	const onPressStart = useCallback((id: string) => setPressedKey(id), []);
	const onPressEnd = useCallback(() => setPressedKey(null), []);

	function tryClose() {
		if (Date.now() - openedAtRef.current < 300) return;
		onClose();
	}

	const handleChar = useCallback(
		(char: string) => {
			insertAtCursor(shifted ? char.toUpperCase() : char, targetRef);
			if (shifted) setShifted(false);
		},
		[shifted, targetRef],
	);

	const handleDelete = useCallback(
		() => deleteAtCursor(targetRef),
		[targetRef],
	);

	const handleEnter = () => {
		onEnter?.();
		onClose();
	};

	// Shared props every Key needs
	const kp = { pressedKey, onPressStart, onPressEnd };

	return ReactDOM.createPortal(
		<>
			{/* Backdrop */}
			<Box
				onMouseDown={(e) => {
					e.preventDefault();
					e.stopPropagation(); // ← stops the click reaching the library behind
					tryClose();
				}}
				onTouchEnd={(e) => {
					e.preventDefault();
					e.stopPropagation(); // ← stops the tap reaching the library behind
					tryClose();
				}}
				sx={{ position: "fixed", inset: 0, zIndex: 9998 }}
			/>

			{/* Keyboard panel */}
			<Box
				onMouseDown={(e) => e.stopPropagation()}
				onTouchStart={(e) => e.stopPropagation()}
				onTouchEnd={(e) => e.stopPropagation()}
				sx={{
					position: "fixed",
					bottom: 0,
					left: 0,
					right: 0,
					zIndex: 9999,
					background: "rgba(12, 12, 12, 0.97)",
					backdropFilter: "blur(24px)",
					WebkitBackdropFilter: "blur(24px)",
					borderTop: "1px solid rgba(255,255,255,0.1)",
					px: 1,
					pt: 1,
					pb: 2.5,
					display: "flex",
					flexDirection: "column",
					gap: 0.6,
					boxShadow: "0 -8px 40px rgba(0,0,0,0.6)",
				}}
			>
				{/* Numbers */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					{NUM_ROW.map((k) => (
						<Key
							key={k}
							id={`n-${k}`}
							label={k}
							onPress={() => insertAtCursor(k, targetRef)}
							{...kp}
						/>
					))}
					<Key
						id="bksp"
						label="⌫"
						onPress={handleDelete}
						onHold={handleDelete}
						variant="special"
						flex={1.5}
						{...kp}
					/>
				</Box>

				{/* QWERTY */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					{QWERTY.map((k) => (
						<Key
							key={k}
							id={`q-${k}`}
							label={shifted ? k.toUpperCase() : k}
							onPress={() => handleChar(k)}
							{...kp}
						/>
					))}
				</Box>

				{/* ASDF + Enter */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					{ASDF.map((k) => (
						<Key
							key={k}
							id={`a-${k}`}
							label={shifted ? k.toUpperCase() : k}
							onPress={() => handleChar(k)}
							{...kp}
						/>
					))}
					<Key
						id="enter"
						label="↵"
						onPress={handleEnter}
						variant="special"
						flex={1.5}
						{...kp}
					/>
				</Box>

				{/* ZXCV + punctuation */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					<Key
						id="shift-l"
						label="⇧"
						onPress={() => setShifted((s) => !s)}
						variant={shifted ? "active" : "special"}
						flex={1.5}
						{...kp}
					/>
					{ZXCV.map((k) => (
						<Key
							key={k}
							id={`z-${k}`}
							label={shifted ? k.toUpperCase() : k}
							onPress={() => handleChar(k)}
							{...kp}
						/>
					))}
					<Key
						id="dot"
						label="."
						onPress={() => insertAtCursor(".", targetRef)}
						{...kp}
					/>
					<Key
						id="dash"
						label="-"
						onPress={() => insertAtCursor("-", targetRef)}
						{...kp}
					/>
					<Key
						id="shift-r"
						label="⇧"
						onPress={() => setShifted((s) => !s)}
						variant={shifted ? "active" : "special"}
						flex={1.5}
						{...kp}
					/>
				</Box>

				{/* Space + close */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					<Key
						id="space"
						label="space"
						onPress={() => insertAtCursor(" ", targetRef)}
						variant="special"
						flex={7}
						{...kp}
					/>
					<Key
						id="close"
						label="✕  close"
						onPress={onClose}
						variant="special"
						flex={2}
						{...kp}
					/>
				</Box>
			</Box>
		</>,
		document.body,
	);
}
