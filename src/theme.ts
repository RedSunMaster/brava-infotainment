import {
	createTheme,
	type PaletteMode,
	type PaletteColor,
	type SimplePaletteColorOptions,
} from "@mui/material/styles";

declare module "@mui/material/styles" {
	interface Palette {
		surface: PaletteColor;
	}
	interface PaletteOptions {
		surface?: SimplePaletteColorOptions;
	}
}

// ─── NIGHT — instrument cluster amber, deep charcoal, warm off-white ──────────
// Desaturated accents reduce optical vibration against dark backgrounds [HMI principle]
const NIGHT = {
	primary: "#E8A020", // amber — classic analogue gauge colour
	secondary: "#5B8CFF", // cool blue for secondary info panels
	error: "#FF4040", // bright — must cut through at a glance
	warning: "#FFC107",
	info: "#38BDF8",
	success: "#4ADE80",

	bgDefault: "#0F1011", // deep charcoal — not pure black (avoids halos)
	bgPaper: "#181A1C",
	textPrimary: "#E8E6DF", // warm off-white — less glaring than #FFFFFF at night
	textSecondary: "#7A7870",
	textDisabled: "#3E3D3B",
	divider: "#27292B",
	surface: "#1E2124",
};

// ─── DAY — high-contrast, cool grays, strong blue for sunlight readability ────
// Saturated primary needed in daylight — opposite rule to night [web:25]
const DAY = {
	primary: "#1D4ED8", // strong blue — readable in direct sunlight
	secondary: "#6D28D9",
	error: "#DC2626",
	warning: "#D97706",
	info: "#0284C7",
	success: "#15803D",

	bgDefault: "#f3f3f3", // cool mid-gray — reduces glare vs pure white
	bgPaper: "#ECEDF0",
	textPrimary: "#0C0D0E",
	textSecondary: "#4B5563",
	textDisabled: "#9CA3AF",
	divider: "#C5C7CB",
	surface: "#E0E1E4",
};

export function getTheme(mode: PaletteMode) {
	const C = mode === "dark" ? NIGHT : DAY;
	const isNight = mode === "dark";

	return createTheme({
		palette: {
			mode,
			primary: { main: C.primary },
			secondary: { main: C.secondary },
			error: { main: C.error },
			warning: { main: C.warning },
			info: { main: C.info },
			success: { main: C.success },
			background: { default: C.bgDefault, paper: C.bgPaper },
			text: {
				primary: C.textPrimary,
				secondary: C.textSecondary,
				disabled: C.textDisabled,
			},
			divider: C.divider,
			surface: { main: C.surface },
		},

		typography: {
			fontFamily: '"Poppins", sans-serif',

			// ── Automotive rule: larger, heavier, more spaced than typical UI ────────
			// Labels must be readable at a glance in < 1 second [web:32][web:38]
			h1: { fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.01em" },
			h2: { fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.01em" },
			h3: { fontSize: "1.2rem", fontWeight: 600 },

			body1: { fontSize: "1rem", fontWeight: 500 },
			body2: { fontSize: "0.875rem", fontWeight: 400, color: C.textSecondary },

			// Caption used for metric labels — uppercase + spaced for scan speed
			caption: {
				fontSize: "0.7rem",
				fontWeight: 700,
				letterSpacing: "0.1em",
				textTransform: "uppercase" as const,
				color: C.textSecondary,
			},

			// Big numerical readouts (ETA, distance, speed)
			h4: {
				fontSize: "1.75rem",
				fontWeight: 700,
				fontVariantNumeric: "tabular-nums",
			},
			h5: {
				fontSize: "1.4rem",
				fontWeight: 700,
				fontVariantNumeric: "tabular-nums",
			},
			h6: {
				fontSize: "1.1rem",
				fontWeight: 600,
				fontVariantNumeric: "tabular-nums",
			},
		},

		shape: {
			// Slightly tighter radius than consumer apps — more precise/technical feel
			borderRadius: 8,
		},

		components: {
			MuiSlider: {
				styleOverrides: {
					rail: {
						width: 16, // ✅ change here — applies to both sliders
						borderRadius: 4,
					},
					track: {
						width: 16, // ✅ change here — applies to both sliders
						borderRadius: 4,
						border: "none",
					},
					thumb: {
						width: 28,
						height: 28,
						"&:hover, &.Mui-focusVisible": {
							boxShadow: "0 0 0 10px rgba(255,255,255,0.12)",
						},
					},
					mark: {
						width: 4,
						height: 4,
						borderRadius: "50%",
					},
				},
			},
			MuiButton: {
				defaultProps: { disableElevation: true },
				styleOverrides: {
					root: {
						textTransform: "none",
						fontWeight: 700,
						letterSpacing: "0.03em",
						// Taller tap targets — important for use while moving
						paddingTop: 10,
						paddingBottom: 10,
					},
				},
			},

			MuiIconButton: {
				styleOverrides: {
					root: {
						// Larger minimum hit area for gloved/moving use
						minWidth: 44,
						minHeight: 44,
					},
				},
			},

			MuiCard: { styleOverrides: { root: { backgroundImage: "none" } } },
			MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },

			MuiTooltip: {
				defaultProps: { arrow: true },
				styleOverrides: {
					tooltip: {
						fontSize: "0.8rem",
						fontWeight: 600,
					},
				},
			},

			MuiDivider: {
				styleOverrides: {
					root: { borderColor: C.divider },
				},
			},

			MuiCssBaseline: {
				styleOverrides: {
					body: {
						scrollbarWidth: "thin",
						scrollbarColor: `${C.divider} transparent`,
						// Prevent tap highlight flash on touch screens (in-car touchscreens)
						WebkitTapHighlightColor: "transparent",
						// Prevent text selection during swipe gestures
						userSelect: "none",
					},
				},
			},
		},
	});
}
