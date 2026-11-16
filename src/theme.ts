import {
	createTheme,
	type PaletteColor,
	type PaletteMode,
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

const NIGHT = {
	primary: "#F5A800",
	secondary: "#38BDF8",
	error: "#FF3B30",
	warning: "#FFD166",
	info: "#38BDF8",
	success: "#4ADE80",
	bgDefault: "#090B0D",
	bgPaper: "#12161A",
	textPrimary: "#F7F3E8",
	textSecondary: "#B9B5A8",
	textDisabled: "#4D5358",
	divider: "#2A3138",
	surface: "#182027",
};

const DAY = {
	primary: "#FFB000",
	secondary: "#0284C7",
	error: "#FF3B30",
	warning: "#B7791F",
	info: "#0284C7",
	success: "#16A34A",
	bgDefault: "#D3DAE2",
	bgPaper: "#E2E7ED",
	textPrimary: "#101820",
	textSecondary: "#53606B",
	textDisabled: "#A3ACB5",
	divider: "#B8C2CC",
	surface: "#EEF2F6",
};

export function getTheme(mode: PaletteMode) {
	const C = mode === "dark" ? NIGHT : DAY;

	return createTheme({
		palette: {
			mode,
			primary: { main: C.primary, contrastText: "#101214" },
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
			h1: { fontSize: "2rem", fontWeight: 700, letterSpacing: 0 },
			h2: { fontSize: "1.5rem", fontWeight: 700, letterSpacing: 0 },
			h3: { fontSize: "1.2rem", fontWeight: 600, letterSpacing: 0 },
			body1: { fontSize: "1rem", fontWeight: 500 },
			body2: { fontSize: "0.875rem", fontWeight: 400, color: C.textSecondary },
			caption: {
				fontSize: "0.7rem",
				fontWeight: 700,
				letterSpacing: "0.08em",
				textTransform: "uppercase" as const,
				color: C.textSecondary,
			},
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

		shape: { borderRadius: 8 },

		components: {
			MuiSlider: {
				styleOverrides: {
					rail: {
						width: 16,
						borderRadius: 4,
					},
					track: {
						width: 16,
						borderRadius: 4,
						border: "none",
					},
					thumb: {
						width: 30,
						height: 30,
						boxShadow: "0 0 0 3px rgba(0,0,0,0.35)",
						"&:hover, &.Mui-focusVisible": {
							boxShadow: "0 0 0 10px rgba(255,176,0,0.22)",
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
						fontWeight: 800,
						letterSpacing: 0,
						paddingTop: 10,
						paddingBottom: 10,
						borderRadius: 10,
					},
				},
			},
			MuiIconButton: {
				styleOverrides: {
					root: {
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
						WebkitTapHighlightColor: "transparent",
						userSelect: "none",
					},
				},
			},
		},
	});
}
