import { useEffect, useRef, useState } from "react";
import { ipcRenderer, type IpcRendererEvent } from "electron";
export type GpsStatus = "fix" | "no-fix" | "disconnected";
interface GpsUpdate { error?: boolean; mode?: number; lat?: number | null; lon?: number | null; speed?: number; track?: number }
export function useGps(onUpdate: (pos: [number, number], bearing: number, speed: number) => void) {
 const [status, setStatus] = useState<GpsStatus>("disconnected");
 const onUpdateRef = useRef(onUpdate);
 onUpdateRef.current = onUpdate;
 useEffect(() => {
  let lastFix = 0;
  const handler = (_event: IpcRendererEvent, data: GpsUpdate) => {
   if (data.error || data.mode === undefined) { setStatus("disconnected"); return; }
   if (data.mode < 2 || data.lat == null || data.lon == null || !Number.isFinite(data.lat) || !Number.isFinite(data.lon)) { setStatus("no-fix"); return; }
   lastFix = Date.now();
   setStatus("fix");
   onUpdateRef.current([data.lon, data.lat], data.track ?? 0, data.speed ?? 0);
  };
  const interval = window.setInterval(() => { if (lastFix && Date.now() - lastFix > 5000) setStatus("disconnected"); }, 1000);
  ipcRenderer.on("gps-update", handler);
  return () => { window.clearInterval(interval); ipcRenderer.removeListener("gps-update", handler); };
 }, []);
 return { status };
}

