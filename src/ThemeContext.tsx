import React, {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { ThemeProvider, CssBaseline, type PaletteMode } from "@mui/material";
import { getTheme } from "./theme";

interface ThemeContextValue {
	mode: PaletteMode;
	toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
	mode: "dark",
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	toggleMode: () => {},
});

export function useThemeMode() {
	return useContext(ThemeContext);
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
	const [mode, setMode] = useState<PaletteMode>("dark");

	const toggleMode = useCallback(
		() => setMode((m) => (m === "dark" ? "light" : "dark")),
		[],
	);

	// Recreate theme only when mode changes
	const theme = useMemo(() => getTheme(mode), [mode]);

	return (
		<ThemeContext.Provider value={{ mode, toggleMode }}>
			<ThemeProvider theme={theme}>
				<CssBaseline />
				{children}
			</ThemeProvider>
		</ThemeContext.Provider>
	);
}
