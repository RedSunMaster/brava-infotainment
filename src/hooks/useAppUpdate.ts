import { useEffect, useState } from "react";
import type { UpdateState } from "../updaterMain";

interface UpdateBridge {
	getState: () => Promise<UpdateState>;
	apply: () => void;
	check: () => Promise<string>;
	onState: (cb: (state: UpdateState) => void) => () => void;
}

/** Whether a newer version of the app is waiting, and a way to install it. Always "idle" outside the packaged Linux app. */
/** `checkNow` looks for an update right away and resolves with what it found; `checking` is true meanwhile, and `lastResult` keeps the answer for a moment. */
export function useAppUpdate(): { state: UpdateState; apply: () => void; checkNow: () => void; checking: boolean; lastResult: string | null } {
	const [state, setState] = useState<UpdateState>({ phase: "idle" });
	const [checking, setChecking] = useState(false);
	const [lastResult, setLastResult] = useState<string | null>(null);
	const bridge = (window as unknown as { electronUpdate?: UpdateBridge }).electronUpdate;
	useEffect(() => {
		if (!bridge) return;
		let live = true;
		bridge.getState().then(next => { if (live && next) setState(next); }).catch((): void => undefined);
		const off = bridge.onState(next => setState(next));
		return () => { live = false; off(); };
	}, [bridge]);
	const checkNow = () => {
		if (!bridge || checking) return;
		setChecking(true);
		setLastResult(null);
		bridge.check().catch(() => "failed").then(result => {
			setChecking(false);
			setLastResult(result);
			window.setTimeout(() => setLastResult(null), 4000);
		});
	};
	return { state, apply: () => bridge?.apply(), checkNow, checking, lastResult };
}
