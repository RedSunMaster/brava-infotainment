import { useEffect, useState } from "react";
import type { UpdateState } from "../updaterMain";

interface UpdateBridge {
	getState: () => Promise<UpdateState>;
	apply: () => void;
	onState: (cb: (state: UpdateState) => void) => () => void;
}

/** Whether a newer version of the app is waiting, and a way to install it. Always "idle" outside the packaged Linux app. */
export function useAppUpdate(): { state: UpdateState; apply: () => void } {
	const [state, setState] = useState<UpdateState>({ phase: "idle" });
	const bridge = (window as unknown as { electronUpdate?: UpdateBridge }).electronUpdate;
	useEffect(() => {
		if (!bridge) return;
		let live = true;
		bridge.getState().then(next => { if (live && next) setState(next); }).catch((): void => undefined);
		const off = bridge.onState(next => setState(next));
		return () => { live = false; off(); };
	}, [bridge]);
	return { state, apply: () => bridge?.apply() };
}
