import React from "react";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useGpsDebug } from "../hooks/useGpsDebug";
import type { GpsStatus } from "../hooks/useGps";
import { gnssName, type GpsDebugSatellite } from "../lib/gpsDebug";

const FIX_LABELS: Record<number, string> = { 0: "Unknown", 1: "No fix", 2: "2D fix", 3: "3D fix" };

function ago(now: number, at: number | null | undefined): string {
	if (!at) return "never";
	const s = Math.max(0, Math.round((now - at) / 1000));
	return s < 2 ? "just now" : s < 120 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}
function fmt(v: number | null | undefined, digits: number, unit = ""): string {
	return v === null || v === undefined ? "–" : `${v.toFixed(digits)}${unit}`;
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "warning" | "error" }) {
	return (
		<Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
			<Typography sx={{ fontSize: 21, color: "text.secondary" }}>{label}</Typography>
			<Typography sx={{ fontSize: 21, fontWeight: 700, textAlign: "right", color: tone ? `${tone}.main` : "text.primary", wordBreak: "break-word" }}>{value}</Typography>
		</Box>
	);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<Box sx={{ display: "grid", gap: 0.25 }}>
			<Typography sx={{ fontSize: 25, fontWeight: 700, mb: 0.5 }}>{title}</Typography>
			{children}
		</Box>
	);
}

/** Satellites as seen from above: centre is straight up, the rim is the horizon, top is north. */
function SkyPlot({ sats }: { sats: GpsDebugSatellite[] }) {
	const theme = useTheme();
	const size = 260, c = size / 2, r = c - 14;
	return (
		<svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: 300 }} role="img" aria-label="Satellite sky plot">
			{[1, 2 / 3, 1 / 3].map((k) => <circle key={k} cx={c} cy={c} r={r * k} fill="none" stroke={theme.palette.divider} />)}
			<line x1={c} y1={c - r} x2={c} y2={c + r} stroke={theme.palette.divider} />
			<line x1={c - r} y1={c} x2={c + r} y2={c} stroke={theme.palette.divider} />
			<text x={c} y={11} textAnchor="middle" fontSize="12" fill={theme.palette.text.secondary}>N</text>
			{sats.filter((s) => s.el !== null && s.az !== null).map((s) => {
				const rad = ((s.az as number) * Math.PI) / 180;
				const d = r * (1 - (s.el as number) / 90);
				const x = c + d * Math.sin(rad), y = c - d * Math.cos(rad);
				const color = s.used ? theme.palette.success.main : theme.palette.text.disabled;
				return (
					<g key={`${s.gnss}-${s.prn}`}>
						<circle cx={x} cy={y} r={10} fill={color} fillOpacity={s.used ? 0.9 : 0.35} />
						<text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={theme.palette.background.paper}>{s.prn}</text>
					</g>
				);
			})}
		</svg>
	);
}

function SignalBars({ sats }: { sats: GpsDebugSatellite[] }) {
	const theme = useTheme();
	const sorted = [...sats].sort((a, b) => Number(b.used) - Number(a.used) || (b.ss ?? 0) - (a.ss ?? 0));
	return (
		<Box sx={{ display: "grid", gap: 0.5, minWidth: 0 }}>
			{sorted.map((s) => {
				const ss = s.ss ?? 0;
				// 50 dB-Hz is a strong signal; below about 25 is barely usable.
				const pct = Math.min(100, (ss / 50) * 100);
				const color = !s.used ? theme.palette.text.disabled : ss >= 35 ? theme.palette.success.main : ss >= 25 ? theme.palette.warning.main : theme.palette.error.main;
				return (
					<Box key={`${s.gnss}-${s.prn}`} sx={{ display: "grid", gridTemplateColumns: "minmax(88px, 120px) 1fr 52px", gap: 1, alignItems: "center" }}>
						<Typography noWrap sx={{ fontSize: 18, color: s.used ? "text.primary" : "text.secondary" }}>{gnssName(s.gnss)} {s.prn}</Typography>
						<Box sx={{ height: 12, borderRadius: 6, bgcolor: "action.hover", overflow: "hidden" }}>
							<Box sx={{ height: "100%", width: `${pct}%`, bgcolor: color }} />
						</Box>
						<Typography sx={{ fontSize: 18, textAlign: "right", color: "text.secondary" }}>{s.ss === null ? "–" : Math.round(ss)}</Typography>
					</Box>
				);
			})}
		</Box>
	);
}

/** Settings → GPS: live gpsd, receiver and satellite details, for working out why there is no fix. */
export default function GpsDebugPanel({ active, status }: { active: boolean; status: GpsStatus }) {
	const { snapshot: d, now } = useGpsDebug(active);
	if (!d) return <Typography sx={{ fontSize: 22, color: "text.secondary" }}>Reading GPS status…</Typography>;

	const tpv = d.tpv, sky = d.sky;
	const sats = sky?.satellites ?? [];
	const used = sats.filter((s) => s.used);
	const byConstellation = new Map<string, { seen: number; used: number }>();
	for (const s of sats) {
		const k = gnssName(s.gnss);
		const e = byConstellation.get(k) ?? { seen: 0, used: 0 };
		e.seen += 1; if (s.used) e.used += 1;
		byConstellation.set(k, e);
	}
	const strongest = sats.reduce((m, s) => Math.max(m, s.ss ?? 0), 0);

	const daemonText = d.daemon === "connected" ? `Connected${d.version ? ` (gpsd ${d.version})` : ""}` : d.daemon === "connecting" ? "Connecting…" : "Not reachable";
	const daemonTone = d.daemon === "connected" ? "success" : d.daemon === "connecting" ? "warning" : "error";
	const noReceiver = d.daemon === "connected" && d.devices.length === 0;
	const fixLabel = tpv ? FIX_LABELS[tpv.mode] ?? `Mode ${tpv.mode}` : "No data yet";
	const fixTone = !tpv || tpv.mode < 2 ? "warning" : "success";

	// One line saying what is wrong, since the rows below are raw.
	let diagnosis: string;
	if (d.daemon !== "connected") diagnosis = "The app cannot reach gpsd. Check that gpsd is running (systemctl status gpsd) and listening on port 2947.";
	else if (noReceiver) diagnosis = "gpsd is running but has no receiver. Check the USB cable and that gpsd knows the device path.";
	else if (!tpv || tpv.mode < 2) diagnosis = sats.length === 0 ? "The receiver is not reporting satellites yet. It may still be starting up." : `Searching: ${sats.length} satellites in view, ${used.length} used. A fix needs at least 3 to 4. Check the antenna has a clear view of the sky.`;
	else diagnosis = `Healthy: ${fixLabel.toLowerCase()} from ${used.length} satellites.`;
	const diagnosisTone = diagnosis.startsWith("Healthy") ? "success" : d.daemon !== "connected" || noReceiver ? "error" : "warning";

	return (
		<>
			<Box sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: `${diagnosisTone}.main` }}>
				<Typography sx={{ fontSize: 22, fontWeight: 700, color: `${diagnosisTone}.main` }}>{diagnosis}</Typography>
			</Box>

			<Group title="Connection">
				<Row label="gpsd" value={daemonText} tone={daemonTone} />
				<Row label="Address" value={d.host} />
				<Row label="Connected for" value={d.connectedSince ? ago(now, d.connectedSince).replace(" ago", "") : "–"} />
				<Row label="Last data" value={ago(now, d.lastMessageAt)} />
				<Row label="App GPS status" value={status === "fix" ? "Fix" : status === "no-fix" ? "No fix" : "Disconnected"} tone={status === "fix" ? "success" : status === "no-fix" ? "warning" : "error"} />
				<Row label="Reconnect attempts" value={d.reconnects} />
				{d.lastError && <Row label="Last error" value={d.lastError} tone="error" />}
				<Row label="Messages" value={Object.keys(d.messageCounts).length ? Object.entries(d.messageCounts).map(([k, v]) => `${k} ${v}`).join(" · ") : "none"} />
			</Group>

			<Group title="Receiver">
				{d.devices.length === 0 ? <Row label="Devices" value="None" tone={d.daemon === "connected" ? "error" : undefined} /> : d.devices.map((dev) => (
					<React.Fragment key={dev.path}>
						<Row label="Device" value={dev.path} />
						<Row label="Driver" value={[dev.driver, dev.subtype].filter(Boolean).join(" · ") || "Not identified yet"} />
						<Row label="Baud rate" value={dev.bps ?? "–"} />
						<Row label="Activated" value={dev.activated ? "Yes" : "No"} tone={dev.activated ? "success" : "warning"} />
					</React.Fragment>
				))}
			</Group>

			<Group title="Position">
				<Row label="Fix" value={fixLabel} tone={fixTone} />
				<Row label="Last position" value={tpv ? ago(now, tpv.receivedAt) : "never"} />
				<Row label="Latitude" value={fmt(tpv?.lat, 6, "°")} />
				<Row label="Longitude" value={fmt(tpv?.lon, 6, "°")} />
				<Row label="Altitude" value={fmt(tpv?.alt, 1, " m")} />
				<Row label="Speed" value={tpv?.speed == null ? "–" : `${(tpv.speed * 3.6).toFixed(1)} km/h`} />
				<Row label="Heading" value={fmt(tpv?.track, 0, "°")} />
				<Row label="GPS time" value={tpv?.time ?? "–"} />
				<Row label="Error (x / y / alt)" value={tpv ? `${fmt(tpv.epx, 1)} / ${fmt(tpv.epy, 1)} / ${fmt(tpv.epv, 1)} m` : "–"} />
			</Group>

			<Group title="Satellites">
				<Row label="In view / used" value={`${sats.length} / ${used.length}`} tone={used.length >= 4 ? "success" : sats.length ? "warning" : "error"} />
				<Row label="Strongest signal" value={sats.length ? `${Math.round(strongest)} dB-Hz` : "–"} />
				<Row label="HDOP / VDOP / PDOP" value={sky ? `${fmt(sky.hdop, 2)} / ${fmt(sky.vdop, 2)} / ${fmt(sky.pdop, 2)}` : "–"} />
				{[...byConstellation].map(([name, e]) => <Row key={name} label={name} value={`${e.used} used of ${e.seen}`} />)}
				<Row label="Satellite data" value={sky ? ago(now, sky.receivedAt) : "never"} />
				{sats.length > 0 && (
					<Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 2, mt: 1.5, alignItems: "start" }}>
						<SkyPlot sats={sats} />
						<SignalBars sats={sats} />
					</Box>
				)}
			</Group>
		</>
	);
}
