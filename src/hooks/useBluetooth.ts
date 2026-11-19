import { useCallback, useEffect, useRef, useState } from "react";
import { ipcRenderer } from "electron";
import type { BluetoothAction, BluetoothResult, BluetoothState } from "../lib/bluetooth";

const POLL_MS = 2000;

/** Bluetooth state and controls from the main process. Polls only while the Bluetooth settings tab is open. */
export function useBluetooth(active: boolean) {
	const [state, setState] = useState<BluetoothState | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const alive = useRef(true);

	const refresh = useCallback(async () => {
		try {
			const next: BluetoothState = await ipcRenderer.invoke("bt:state");
			if (alive.current) setState(next);
		} catch { /* keep the last state */ }
	}, []);

	useEffect(() => {
		alive.current = true;
		if (!active) return;
		void refresh();
		const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
		return () => {
			alive.current = false;
			window.clearInterval(timer);
			// Leaving the tab ends any scan that is still running.
			void ipcRenderer.invoke("bt:scan", false);
		};
	}, [active, refresh]);

	const setPower = useCallback(async (on: boolean) => { await ipcRenderer.invoke("bt:power", on); await refresh(); }, [refresh]);
	const setScan = useCallback(async (on: boolean) => { await ipcRenderer.invoke("bt:scan", on); await refresh(); }, [refresh]);
	const run = useCallback(async (mac: string, action: BluetoothAction) => {
		setBusy(mac);
		setMessage(null);
		try {
			const result: BluetoothResult = await ipcRenderer.invoke("bt:action", mac, action);
			if (alive.current) setMessage(result.message);
		} finally {
			if (alive.current) setBusy(null);
			await refresh();
		}
	}, [refresh]);

	return { state, busy, message, setPower, setScan, run };
}
