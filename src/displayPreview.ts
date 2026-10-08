export type PreviewSizeMode = "fit" | "pixels" | "physical";

export interface DisplayPreviewSettings {
	width: number;
	height: number;
	ppi: number;
	uiScale: number;
	sizeMode: PreviewSizeMode;
	desktopPpi: number;
}

export interface DisplayPreviewState {
	enabled: boolean;
	settings: DisplayPreviewSettings;
}

export interface DisplayPreviewBridge {
	get: () => Promise<DisplayPreviewState>;
	apply: (settings: DisplayPreviewSettings) => Promise<DisplayPreviewState>;
	onOpen: (callback: () => void) => () => void;
}

export const DEFAULT_DISPLAY_PREVIEW: DisplayPreviewSettings = {
	width: 1080,
	height: 1920,
	ppi: Number((Math.hypot(1920, 1080) / 15.6).toFixed(1)),
	uiScale: 1,
	sizeMode: "fit",
	desktopPpi: Number((Math.hypot(1920, 1080) / 27).toFixed(1)),
};

export function validateDisplayPreview(
	settings: DisplayPreviewSettings,
): string | null {
	if (!settings || typeof settings !== "object")
		return "Invalid display settings.";
	if (
		![settings.width, settings.height].every(
			(value) => Number.isInteger(value) && value >= 320 && value <= 7680,
		)
	) {
		return "Resolution must use whole numbers from 320 to 7680 pixels.";
	}
	if (
		!Number.isFinite(settings.ppi) ||
		settings.ppi < 40 ||
		settings.ppi > 1000
	)
		return "PPI must be between 40 and 1000.";
	if (
		!Number.isFinite(settings.uiScale) ||
		settings.uiScale < 0.5 ||
		settings.uiScale > 3
	)
		return "System scaling must be between 50% and 300%.";
	if (!["fit", "pixels", "physical"].includes(settings.sizeMode))
		return "Choose a preview size.";
	if (
		!Number.isFinite(settings.desktopPpi) ||
		settings.desktopPpi < 40 ||
		settings.desktopPpi > 1000
	)
		return "Desktop PPI must be between 40 and 1000.";
	return null;
}

export interface PreviewDesktop {
	width: number;
	height: number;
	scaleFactor: number;
}

export interface PreviewGeometry {
	width: number;
	height: number;
	zoomFactor: number;
}

export function previewGeometry(
	settings: DisplayPreviewSettings,
	desktop: PreviewDesktop,
): PreviewGeometry {
	const availableWidth = Math.max(100, desktop.width - 80);
	const availableHeight = Math.max(100, desktop.height - 100);
	const pixelRatio =
		settings.sizeMode === "physical" ? settings.desktopPpi / settings.ppi : 1;
	const nativeWidth = (settings.width * pixelRatio) / desktop.scaleFactor;
	const nativeHeight = (settings.height * pixelRatio) / desktop.scaleFactor;
	const fit =
		settings.sizeMode === "fit"
			? Math.min(
					1,
					availableWidth / nativeWidth,
					availableHeight / nativeHeight,
				)
			: 1;
	const width = Math.round(nativeWidth * fit);
	const height = Math.round(nativeHeight * fit);
	return {
		width,
		height,
		zoomFactor: (width * settings.uiScale) / settings.width,
	};
}
