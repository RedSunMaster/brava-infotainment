import React from "react";
import { Box, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import { useBluetooth } from "../hooks/useBluetooth";
import { isUnnamed, type BluetoothDevice } from "../lib/bluetooth";

function kind(icon: string | null): string {
	if (!icon) return "Device";
	if (/headset|headphones/.test(icon)) return "Headset";
	if (/audio/.test(icon)) return "Speaker";
	if (/phone/.test(icon)) return "Phone";
	if (/computer/.test(icon)) return "Computer";
	return "Device";
}

function DeviceRow({ d, busy, locked, onRun }: { d: BluetoothDevice; busy: boolean; locked: boolean; onRun: (action: "pair" | "connect" | "disconnect" | "forget") => void }) {
	const status = d.connected ? "Connected" : d.paired ? "Paired" : d.rssi !== null ? `Nearby · ${d.rssi} dBm` : "Nearby";
	return (
		<Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
			<Box sx={{ flex: 1, minWidth: 0 }}>
				<Typography noWrap sx={{ fontSize: 24, fontWeight: 700 }}>{d.name}</Typography>
				<Typography noWrap sx={{ fontSize: 19, color: d.connected ? "success.main" : "text.secondary" }}>{busy ? "Working…" : `${kind(d.icon)} · ${status}`}</Typography>
			</Box>
			{d.connected && <DriveButton color="inherit" variant="outlined" disabled={locked} onClick={() => onRun("disconnect")}>Disconnect</DriveButton>}
			{d.paired && !d.connected && <DriveButton color="inherit" variant="contained" disabled={locked} onClick={() => onRun("connect")}>Connect</DriveButton>}
			{!d.paired && <DriveButton color="inherit" variant="contained" disabled={locked} onClick={() => onRun("pair")}>Pair</DriveButton>}
			{d.paired && <DriveButton color="error" variant="outlined" disabled={locked} aria-label={`Forget ${d.name}`} onClick={() => onRun("forget")}>Forget</DriveButton>}
		</Box>
	);
}

/** Settings → Bluetooth: switch the adapter on, find speakers and headsets, pair, connect and forget them. */
export default function BluetoothPanel({ active }: { active: boolean }) {
	const { state, busy, message, setPower, setScan, run } = useBluetooth(active);
	if (!state) return <Typography sx={{ fontSize: 22, color: "text.secondary" }}>Reading Bluetooth status…</Typography>;
	if (!state.available) return <Typography sx={{ fontSize: 22, color: "error.main", fontWeight: 700 }}>{state.error}</Typography>;

	const mine = state.devices.filter((d) => d.paired).sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
	const nearby = state.devices.filter((d) => !d.paired && !isUnnamed(d)).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
	const locked = busy !== null;

	return (
		<>
			<Box sx={{ display: "grid", gap: 1.25 }}>
				<Box>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>Bluetooth</Typography>
					<Typography sx={{ fontSize: 20, color: "text.secondary" }}>A connected speaker or headset becomes the sound output. Devices that need a PIN cannot be paired here.</Typography>
				</Box>
				<Box role="group" aria-label="Bluetooth power" sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
					<DriveButton className="settings-option" variant={state.powered ? "contained" : "outlined"} aria-pressed={state.powered} onClick={() => setPower(true)}>On</DriveButton>
					<DriveButton className="settings-option" variant={!state.powered ? "contained" : "outlined"} aria-pressed={!state.powered} onClick={() => setPower(false)}>Off</DriveButton>
				</Box>
				{message && <Typography role="status" sx={{ fontSize: 21, fontWeight: 700 }}>{message}</Typography>}
			</Box>

			{state.powered && <>
				<Box sx={{ display: "grid", gap: 1.25 }}>
					<Typography sx={{ fontSize: 25, fontWeight: 700 }}>My devices</Typography>
					{mine.length === 0 && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>Nothing paired yet. Put your speaker in pairing mode, then search below.</Typography>}
					{mine.map((d) => <DeviceRow key={d.mac} d={d} busy={busy === d.mac} locked={locked} onRun={(a) => run(d.mac, a)} />)}
				</Box>

				<Box sx={{ display: "grid", gap: 1.25 }}>
					<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
						<Typography sx={{ fontSize: 25, fontWeight: 700, flex: 1 }}>Nearby</Typography>
						<DriveButton color="inherit" variant={state.discovering ? "contained" : "outlined"} disabled={locked} onClick={() => setScan(!state.discovering)}>{state.discovering ? "Stop searching" : "Search"}</DriveButton>
					</Box>
					{state.discovering && nearby.length === 0 && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>Searching… make sure the device is switched on and in pairing mode.</Typography>}
					{!state.discovering && nearby.length === 0 && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>Tap Search to look for devices.</Typography>}
					{nearby.map((d) => <DeviceRow key={d.mac} d={d} busy={busy === d.mac} locked={locked} onRun={(a) => run(d.mac, a)} />)}
				</Box>
			</>}
		</>
	);
}
