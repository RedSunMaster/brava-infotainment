import React, { useCallback, useEffect, useState } from "react";
import { ipcRenderer } from "electron";
import { Box, TextField, Typography } from "@mui/material";
import DriveButton from "./DriveButton";
import { useKeyboard } from "../contexts/KeyboardContext";

type Tether = { name: string; uuid: string; connected: boolean; preferred: boolean };
type Network = { ssid: string; signal: number; security: string; connected: boolean };
export default function WifiPanel({ isDriving }: { isDriving: boolean }) {
 const [tethers, setTethers] = useState<Tether[]>([]);
 const [tetherError, setTetherError] = useState("");
 const [networks, setNetworks] = useState<Network[]>([]);
 const [wifiError, setWifiError] = useState<string | null>(null);
 const [wifiLoaded, setWifiLoaded] = useState(false);
 const [message, setMessage] = useState("");
 const [selected, setSelected] = useState<Network | null>(null);
 const [password, setPassword] = useState("");
 const [busy, setBusy] = useState(false);
 const { showKeyboard, hideKeyboard } = useKeyboard();
 const refresh = useCallback(async () => { const [state, tether] = await Promise.all([ipcRenderer.invoke("wifi:state"), ipcRenderer.invoke("tether:state")]); setNetworks(state.networks); setWifiError(state.error); setWifiLoaded(true); setTethers(tether.connections); setTetherError(tether.error ?? ""); }, []);
 useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 10000); return () => { clearInterval(timer); hideKeyboard(); }; }, [refresh, hideKeyboard]);
 async function connect(network: Network, secret = "") {
  setBusy(true); setMessage("Connecting…"); hideKeyboard();
  try { const result = await ipcRenderer.invoke("wifi:connect", network.ssid, secret); setMessage(result.message); if (result.ok) { setSelected(null); setPassword(""); } await refresh(); }
  catch { setMessage("Could not connect."); } finally { setBusy(false); }
 }
 async function disconnect() {
  setBusy(true); setMessage("Disconnecting…");
  try { const result = await ipcRenderer.invoke("wifi:disconnect"); setMessage(result.message); await refresh(); }
  catch { setMessage("Could not disconnect Wi-Fi."); } finally { setBusy(false); }
 }
 async function tetherAction(tether: Tether) {
  setBusy(true); setMessage(tether.connected ? "Disconnecting Bluetooth tethering…" : "Connecting Bluetooth tethering…");
  try { const result = await ipcRenderer.invoke("tether:action", tether.uuid, !tether.connected); setMessage(result.message); await refresh(); }
  catch { setMessage("Could not change Bluetooth tethering."); } finally { setBusy(false); }
 }
 return <Box sx={{ display: "grid", gap: 2 }}>
  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 25, fontWeight: 700 }}>Wi-Fi</Typography><Typography sx={{ fontSize: 20, color: "text.secondary" }}>Choose a network while parked. Signal strength is shown as a percentage.</Typography></Box><DriveButton variant="outlined" disabled={busy || isDriving} onClick={() => { setBusy(true); void ipcRenderer.invoke("wifi:scan").then(refresh).finally(() => setBusy(false)); }}>Refresh</DriveButton></Box>
  <Typography role="status" sx={{ fontSize: 22, fontWeight: 700 }}>{wifiError ? wifiError : !wifiLoaded ? "Checking Wi-Fi…" : networks.find(network => network.connected) ? `Connected to ${networks.find(network => network.connected)!.ssid}` : "Not connected to Wi-Fi"}</Typography>
  {message && <Typography role="status" sx={{ fontSize: 20 }}>{message}</Typography>}
  {networks.map(network => <Box key={network.ssid} sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 24, fontWeight: 700 }}>{network.ssid}</Typography><Typography sx={{ fontSize: 19, color: "text.secondary" }}>{network.connected ? "Connected · " : ""}{network.signal}% · {network.security || "Open"}</Typography></Box>{network.connected ? <DriveButton variant="outlined" disabled={busy || isDriving} onClick={() => void disconnect()}>Disconnect</DriveButton> : <DriveButton variant="contained" disabled={busy || isDriving} onClick={() => { setSelected(network); setPassword(""); if (!network.security) void connect(network); }}>Connect</DriveButton>}</Box>)}
  <Box sx={{ display: "grid", gap: 1 }}>
   <Typography sx={{ fontSize: 25, fontWeight: 700 }}>Bluetooth tethering</Typography>
   <Typography sx={{ fontSize: 20, color: "text.secondary" }}>Pair your phone in Bluetooth settings and enable Bluetooth tethering on the phone. Wi-Fi may be used when both are connected.</Typography>
   {tetherError ? <Typography role="status" sx={{ fontSize: 20 }}>{tetherError}</Typography> : tethers.length === 0 ? <Typography sx={{ fontSize: 20, color: "text.secondary" }}>No Bluetooth tethering connection found. Enable tethering on your paired phone.</Typography> : tethers.map(tether => <Box key={tether.uuid} sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontSize: 24, fontWeight: 700 }}>{tether.name}</Typography><Typography sx={{ fontSize: 19, color: "text.secondary" }}>{tether.connected ? (tether.preferred ? "Connected · Internet route" : "Connected · Not the preferred internet route") : "Disconnected"}</Typography></Box><DriveButton variant={tether.connected ? "outlined" : "contained"} disabled={busy || isDriving} onClick={() => void tetherAction(tether)}>{tether.connected ? "Disconnect" : "Connect"}</DriveButton></Box>)}
  </Box>
  {selected && !!selected.security && <Box sx={{ display: "grid", gap: 1 }}><Typography sx={{ fontSize: 21 }}>Password for {selected.ssid} (leave blank for a saved network)</Typography><TextField type="password" label="Wi-Fi password" value={password} onFocus={() => showKeyboard()} onChange={e => setPassword(e.target.value)} /><Box sx={{ display: "flex", gap: 1 }}><DriveButton variant="contained" disabled={busy || isDriving} onClick={() => void connect(selected, password)}>Connect</DriveButton><DriveButton variant="outlined" onClick={() => { hideKeyboard(); setSelected(null); setPassword(""); }}>Cancel</DriveButton></Box></Box>}
 </Box>;
}
