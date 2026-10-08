import { ipcRenderer } from "electron";
import type {
	DisplayPreviewBridge,
	DisplayPreviewSettings,
	DisplayPreviewState,
} from "./displayPreview";

export const displayPreviewBridge: DisplayPreviewBridge = {
	get: (): Promise<DisplayPreviewState> =>
		ipcRenderer.invoke("display-preview:get"),
	apply: (settings: DisplayPreviewSettings): Promise<DisplayPreviewState> =>
		ipcRenderer.invoke("display-preview:apply", settings),
	onOpen: (callback) => {
		const handler = () => callback();
		ipcRenderer.on("display-preview:open", handler);
		return () => ipcRenderer.removeListener("display-preview:open", handler);
	},
};
