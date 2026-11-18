import React, { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { keyframes } from "@emotion/react";

// Slides to the end of the text, rests, slides back, rests. `--shift` is how far the text overhangs.
const slide = keyframes`0%, 14% { transform: translateX(0); } 86%, 100% { transform: translateX(calc(-1 * var(--shift))); }`;

/**
 * One line of text that stays still when it fits and scrolls back and forth when it is too long, so a long song
 * title or artist can be read in full without wrapping or being cut off. It runs even when the system asks for
 * reduced motion, because it is how the full text is shown, not decoration.
 */
export default function Marquee({ children, sx }: { children: string; sx?: SxProps<Theme> }) {
	const outer = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLSpanElement>(null);
	const [shift, setShift] = useState(0);
	useEffect(() => {
		const measure = () => {
			const box = outer.current, text = inner.current;
			if (box && text) setShift(Math.max(0, Math.ceil(text.offsetWidth - box.clientWidth)));
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		if (outer.current) observer.observe(outer.current);
		if (inner.current) observer.observe(inner.current);
		return () => observer.disconnect();
	}, [children]);
	// About 40 px a second, plus the rests at each end.
	const seconds = 4 + shift / 40;
	return (
		<Box ref={outer} title={shift > 0 ? children : undefined} sx={[{ overflow: "hidden", whiteSpace: "nowrap", minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
			<Box ref={inner} component="span" key={children} sx={{ display: "inline-block", ...(shift > 0 ? { "--shift": `${shift}px`, animation: `${slide} ${seconds}s linear infinite alternate` } : {}) }}>{children}</Box>
		</Box>
	);
}
