import React, { useState, useCallback, RefObject } from "react";
import ReactDOM from "react-dom";
import { Box } from "@mui/material";

const NUM_ROW = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const QWERTY = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
const ASDF = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const ZXCV = ["z", "x", "c", "v", "b", "n", "m"];

// ── Mutation helpers ─────────────────────────────────────────────────────────
// Uses the stored ref so fast typing never loses the target element.

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
	el.setSelectionRange(pos, pos);
}

// ── Key button ───────────────────────────────────────────────────────────────
type KeyVariant = "default" | "special" | "active";

function Key({
	label,
	onPress,
	flex = 1,
	variant = "default",
}: {
	label: React.ReactNode;
	onPress: () => void;
	flex?: number;
	variant?: KeyVariant;
}) {
	const bg: Record<KeyVariant, string> = {
		default: "rgba(255,255,255,0.13)",
		special: "rgba(255,255,255,0.07)",
		active: "rgba(255,255,255,0.92)",
	};

	return (
		<Box
			component="button"
			// Prevent ANY default pointer behaviour so the input never loses focus
			onMouseDown={(e: React.MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
			}}
			onTouchStart={(e: React.TouchEvent) => {
				e.preventDefault();
				e.stopPropagation();
			}}
			onTouchEnd={(e: React.TouchEvent) => {
				e.preventDefault();
				e.stopPropagation();
				onPress();
			}}
			onClick={onPress}
			sx={{
				flex,
				minWidth: 0,
				height: 52,
				background: bg[variant],
				border: "1px solid rgba(255,255,255,0.08)",
				borderRadius: "8px",
				color: variant === "active" ? "#111" : "rgba(255,255,255,0.9)",
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
				transition: "background 0.08s",
				p: 0,
				"&:active": { background: "rgba(255,255,255,0.28)" },
			}}
		>
			{label}
		</Box>
	);
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
	targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
	onEnter?: () => void;
	onClose: () => void;
}

export default function InAppKeyboard({ targetRef, onEnter, onClose }: Props) {
	const [shifted, setShifted] = useState(false);

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

	return ReactDOM.createPortal(
		<>
			{/* ── Backdrop: tap anywhere outside keyboard to close ── */}
			<Box
				onMouseDown={(e) => {
					e.preventDefault();
					onClose();
				}}
				onTouchStart={(e) => {
					e.preventDefault();
					onClose();
				}}
				sx={{
					position: "fixed",
					inset: 0,
					zIndex: 9998,
					// transparent — just catches taps
				}}
			/>

			{/* ── Keyboard panel ── */}
			<Box
				onMouseDown={(e) => e.stopPropagation()}
				onTouchStart={(e) => e.stopPropagation()}
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
							label={k}
							onPress={() => insertAtCursor(k, targetRef)}
						/>
					))}
					<Key label="⌫" onPress={handleDelete} variant="special" flex={1.5} />
				</Box>

				{/* QWERTY */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					{QWERTY.map((k) => (
						<Key
							key={k}
							label={shifted ? k.toUpperCase() : k}
							onPress={() => handleChar(k)}
						/>
					))}
				</Box>

				{/* ASDF + Enter */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					{ASDF.map((k) => (
						<Key
							key={k}
							label={shifted ? k.toUpperCase() : k}
							onPress={() => handleChar(k)}
						/>
					))}
					<Key label="↵" onPress={handleEnter} variant="special" flex={1.5} />
				</Box>

				{/* ZXCV + punctuation */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					<Key
						label="⇧"
						onPress={() => setShifted((s) => !s)}
						variant={shifted ? "active" : "special"}
						flex={1.5}
					/>
					{ZXCV.map((k) => (
						<Key
							key={k}
							label={shifted ? k.toUpperCase() : k}
							onPress={() => handleChar(k)}
						/>
					))}
					<Key label="." onPress={() => insertAtCursor(".", targetRef)} />
					<Key label="-" onPress={() => insertAtCursor("-", targetRef)} />
					<Key
						label="⇧"
						onPress={() => setShifted((s) => !s)}
						variant={shifted ? "active" : "special"}
						flex={1.5}
					/>
				</Box>

				{/* Space + close */}
				<Box sx={{ display: "flex", gap: 0.5 }}>
					<Key
						label="space"
						onPress={() => insertAtCursor(" ", targetRef)}
						variant="special"
						flex={7}
					/>
					<Key label="✕  close" onPress={onClose} variant="special" flex={2} />
				</Box>
			</Box>
		</>,
		document.body,
	);
}
