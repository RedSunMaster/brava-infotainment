import React, { useEffect, useState } from "react";
import {
	Alert,
	Box,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	MenuItem,
	TextField,
	Typography,
} from "@mui/material";
import {
	DEFAULT_DISPLAY_PREVIEW,
	validateDisplayPreview,
	type DisplayPreviewSettings,
	type PreviewSizeMode,
} from "../displayPreview";
import { displayPreviewBridge } from "../displayPreviewRenderer";

export default function DisplayPreviewDialog() {
	const [open, setOpen] = useState(false);
	const [settings, setSettings] = useState<DisplayPreviewSettings>({
		...DEFAULT_DISPLAY_PREVIEW,
	});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const bridge = displayPreviewBridge;
		let active = true;
		const unsubscribe = bridge.onOpen(() => {
			setOpen(true);
			setLoading(true);
			setError(null);
			bridge
				.get()
				.then((state) => {
					if (active) setSettings(state.settings);
				})
				.catch((cause: Error) => {
					if (active) setError(cause.message);
				})
				.finally(() => {
					if (active) setLoading(false);
				});
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	const updateNumber = (
		key: "width" | "height" | "ppi" | "uiScale" | "desktopPpi",
		value: string,
	) => {
		setSettings((previous) => ({
			...previous,
			[key]: value === "" ? Number.NaN : Number(value),
		}));
		setError(null);
	};
	const validationError = validateDisplayPreview(settings);
	const diagonal = Math.hypot(settings.width, settings.height) / settings.ppi;
	const apply = async () => {
		if (validationError) return;
		setSaving(true);
		setError(null);
		try {
			await displayPreviewBridge.apply(settings);
			setOpen(false);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not save display settings.",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onClose={() => {
				if (!saving) setOpen(false);
			}}
			aria-labelledby="display-preview-title"
			fullWidth
			maxWidth="sm"
		>
			<DialogTitle id="display-preview-title">Simulate a monitor</DialogTitle>
			<DialogContent>
				{loading ? (
					<Typography role="status">Loading display settings…</Typography>
				) : (
					<Box sx={{ display: "grid", gap: 2, pt: 1 }}>
						<Box
							sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}
						>
							<TextField
								label="Width (pixels)"
								type="number"
								value={Number.isFinite(settings.width) ? settings.width : ""}
								onChange={(event) => updateNumber("width", event.target.value)}
								slotProps={{ htmlInput: { min: 320, max: 7680, step: 1 } }}
							/>
							<TextField
								label="Height (pixels)"
								type="number"
								value={Number.isFinite(settings.height) ? settings.height : ""}
								onChange={(event) => updateNumber("height", event.target.value)}
								slotProps={{ htmlInput: { min: 320, max: 7680, step: 1 } }}
							/>
						</Box>
						<Button
							onClick={() =>
								setSettings((previous) => ({
									...previous,
									width: previous.height,
									height: previous.width,
								}))
							}
						>
							Rotate portrait / landscape
						</Button>
						<Box
							sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}
						>
							<TextField
								label="Monitor PPI"
								type="number"
								value={Number.isFinite(settings.ppi) ? settings.ppi : ""}
								onChange={(event) => updateNumber("ppi", event.target.value)}
								slotProps={{ htmlInput: { min: 40, max: 1000, step: 0.1 } }}
							/>
							<TextField
								label="System scaling (%)"
								type="number"
								value={
									Number.isFinite(settings.uiScale)
										? Math.round(settings.uiScale * 100)
										: ""
								}
								onChange={(event) =>
									updateNumber(
										"uiScale",
										String(
											event.target.value === ""
												? Number.NaN
												: Number(event.target.value) / 100,
										),
									)
								}
								slotProps={{ htmlInput: { min: 50, max: 300, step: 25 } }}
							/>
						</Box>
						<TextField
							select
							label="Preview size"
							value={settings.sizeMode}
							onChange={(event) =>
								setSettings((previous) => ({
									...previous,
									sizeMode: event.target.value as PreviewSizeMode,
								}))
							}
						>
							<MenuItem value="fit">Fit full monitor to desktop</MenuItem>
							<MenuItem value="pixels">
								Native pixels (may exceed desktop)
							</MenuItem>
							<MenuItem value="physical">Match physical size</MenuItem>
						</TextField>
						{settings.sizeMode === "physical" ? (
							<TextField
								label="Your desktop monitor PPI"
								type="number"
								value={
									Number.isFinite(settings.desktopPpi)
										? settings.desktopPpi
										: ""
								}
								helperText="Use your desktop monitor’s measured or specified PPI."
								onChange={(event) =>
									updateNumber("desktopPpi", event.target.value)
								}
								slotProps={{ htmlInput: { min: 40, max: 1000, step: 0.1 } }}
							/>
						) : null}
						{validationError ? (
							<Alert severity="warning">{validationError}</Alert>
						) : (
							<Typography color="text.secondary">
								{diagonal.toFixed(1)}″ ·{" "}
								{((settings.width / settings.ppi) * 25.4).toFixed(0)} ×{" "}
								{((settings.height / settings.ppi) * 25.4).toFixed(0)} mm
								<br />
								Layout: {Math.round(settings.width / settings.uiScale)} ×{" "}
								{Math.round(settings.height / settings.uiScale)} CSS pixels
							</Typography>
						)}
						<Typography variant="body2" color="text.secondary">
							PPI sets physical size. System scaling sets text and control size.
						</Typography>
					</Box>
				)}
				{error ? (
					<Alert severity="error" sx={{ mt: 2 }}>
						{error}
					</Alert>
				) : null}
			</DialogContent>
			<DialogActions>
				<Button
					disabled={saving || loading}
					onClick={() => setSettings({ ...DEFAULT_DISPLAY_PREVIEW })}
				>
					Brava: Verbatim 15.6″
				</Button>
				<Button disabled={saving} onClick={() => setOpen(false)}>
					Cancel
				</Button>
				<Button
					variant="contained"
					disabled={saving || loading || Boolean(validationError)}
					onClick={apply}
				>
					{saving ? "Applying…" : "Apply"}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
