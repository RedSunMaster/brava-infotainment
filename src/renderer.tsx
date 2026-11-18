import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { GlobalStyles } from "@mui/material";
import { AppThemeProvider } from "./ThemeContext";
import { KeyboardProvider } from "./contexts/KeyboardContext";
import { ProfileProvider } from "./contexts/ProfileContext";
import DisplayPreviewDialog from "./components/DisplayPreviewDialog";

const root = createRoot(document.getElementById("root")!);

root.render(
	<ProfileProvider>
	<AppThemeProvider>
		<GlobalStyles styles={{ ":root": { "--car-target": "clamp(76px, 10.4vw, 112px)", "--keyboard-height": "clamp(320px, 26vh, 500px)" }, "button": { touchAction: "manipulation" } }} />
		<KeyboardProvider>
			<App />
			<DisplayPreviewDialog />
		</KeyboardProvider>
	</AppThemeProvider>
	</ProfileProvider>,
);
