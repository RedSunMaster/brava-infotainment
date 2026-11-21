import React from "react";
import { Box, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import { usePhoneLink } from "../hooks/usePhoneLink";
import VoiceVolumes from "./VoiceVolumes";
import { timeAgo } from "../lib/phoneLink";

function Section({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
	return <Box sx={{ display: "grid", gap: 1.25 }}>
		<Box><Typography sx={{ fontSize: 25, fontWeight: 700 }}>{title}</Typography>{hint && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>{hint}</Typography>}</Box>
		{children}
	</Box>;
}

function Choice({ label, value, onChange, on, off }: { label: string; value: boolean; onChange: (value: boolean) => void; on: string; off: string }) {
	return <Box role="group" aria-label={label} sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
		<DriveButton className="settings-option" variant={value ? "contained" : "outlined"} aria-pressed={value} onClick={() => onChange(true)}>{on}</DriveButton>
		<DriveButton className="settings-option" variant={!value ? "contained" : "outlined"} aria-pressed={!value} onClick={() => onChange(false)}>{off}</DriveButton>
	</Box>;
}

/** Settings for notifications from the phone. */
export default function PhoneSettings() {
	const phone = usePhoneLink();
	const { connection, settings } = phone;
	if (!phone.available) return <Typography sx={{ fontSize: 22, color: "text.secondary" }}>The phone link is not available on this computer.</Typography>;
	// Every app seen so far, plus any switched off that were not seen this time.
	const apps = Object.entries({ ...Object.fromEntries(settings.blocked.map((app) => [app, app])), ...settings.apps }).sort(([, a], [, b]) => a.localeCompare(b));
	return <>
		<Section title="Phone" hint={connection.connected
			? `Connected${connection.device ? ` to ${connection.device}` : ""}.`
			: connection.lastSeen ? `Not connected. Last heard ${timeAgo(connection.lastSeen)} ago.` : "Not connected. Pair the phone in Settings > Bluetooth on this computer, then pick it in the Brava Phone Link app."} />
		<Section title="Pop-ups" hint="A card over the map when a notification arrives. It is hidden while you are driving with navigation on; the Phone button in the status bar still counts them.">
			<Choice label="Pop-ups" value={settings.toasts} onChange={phone.setToasts} on="Show" off="Off" />
		</Section>
		<Section title="Text on pop-ups" hint="Hide the message so passengers cannot read it. Only the sender shows.">
			<Choice label="Text on pop-ups" value={settings.showText} onChange={phone.setShowText} on="Show text" off="Sender only" />
		</Section>
		<Section title="Notification sound" hint="A short sound when a notification arrives. It stays quiet while a spoken prompt is playing, and the music dips under it.">
			<Choice label="Notification sound" value={!settings.chimeMuted} onChange={(on) => phone.setChimeMuted(!on)} on="On" off="Muted" />
			{!settings.chimeMuted && <VoiceVolumes only={["chime"]} />}
		</Section>
		<Section title="Apps" hint={apps.length ? "Choose which apps can send notifications to the car." : "Apps appear here after they have sent a notification."}>
			{apps.map(([app, name]) => {
				const allowed = !settings.blocked.includes(app);
				return <Box key={app} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
					<Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 24 }}>{name}</Typography>
					<DriveButton className="settings-option" variant={allowed ? "contained" : "outlined"} aria-pressed={allowed} aria-label={`${name} notifications`} onClick={() => phone.setBlocked(app, allowed)} sx={{ flex: "0 0 150px" }}>{allowed ? "On" : "Off"}</DriveButton>
				</Box>;
			})}
		</Section>
	</>;
}
