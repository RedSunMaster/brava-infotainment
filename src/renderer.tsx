import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppThemeProvider } from "./ThemeContext";
import { KeyboardProvider } from "./contexts/KeyboardContext";

const root = createRoot(document.getElementById("root")!);

root.render(
	<AppThemeProvider>
		<KeyboardProvider>
			<App />
		</KeyboardProvider>
	</AppThemeProvider>,
);
