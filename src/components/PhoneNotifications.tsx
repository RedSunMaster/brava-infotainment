import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseRounded from "@mui/icons-material/CloseRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import DriveButton from "./DriveButton";
import { usePhoneLink } from "../hooks/usePhoneLink";
import { spokenNotification, timeAgo, type StoredNotification } from "../lib/phoneLink";

interface Props {
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
	/** Hide the pop-up while it could cover something the driver needs (navigating at speed). The list and the count still work. */
	quiet?: boolean;
	/** Reads text aloud. Only ever called when the driver taps Read. */
	onRead: (text: string) => void;
}

const CARD = (theme: import("@mui/material/styles").Theme) => ({
	bgcolor: alpha(theme.palette.background.paper, 0.96),
	backdropFilter: "blur(12px)",
	border: "1px solid",
	borderColor: "divider",
	borderRadius: 3,
	boxShadow: 8,
});

const who = (n: StoredNotification) => n.kind === "message" ? (n.sender ?? n.title) : (n.title || n.appName);

/** A card that appears over the map for a few seconds when a notification arrives. Tap it to open the list. */
function Toast({ item, showText, onOpen, onClose }: { item: StoredNotification; showText: boolean; onOpen: () => void; onClose: () => void }) {
	return <Box role="status" aria-live="polite" sx={(theme) => ({ ...CARD(theme), position: "fixed", top: 64, right: 16, zIndex: 35, width: "min(560px, calc(100vw - 32px))", display: "flex", alignItems: "center", gap: 1, pl: 2, pr: 0.5, py: 1 })}>
		<DriveButton color="inherit" aria-label={`Notification from ${item.appName}. Open the list`} onClick={onOpen} sx={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textAlign: "left", py: 0.5 }}>
			<Box sx={{ minWidth: 0, width: "100%" }}>
				<Typography noWrap sx={{ fontSize: 20, color: "text.secondary" }}>{item.appName}</Typography>
				<Typography noWrap sx={{ fontSize: 26, fontWeight: 700 }}>{who(item)}</Typography>
				<Typography sx={{ fontSize: 23, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", color: "text.secondary" }}>{showText ? item.text : "New notification"}</Typography>
			</Box>
		</DriveButton>
		<DriveButton color="inherit" aria-label="Dismiss pop-up" onClick={onClose} sx={{ minWidth: 0, flex: "0 0 64px", minHeight: 64, color: "text.secondary" }}><CloseRounded /></DriveButton>
	</Box>;
}

function Row({ item, onRead, onDismiss }: { item: StoredNotification; onRead: () => void; onDismiss: () => void }) {
	const [expanded, setExpanded] = useState(false);
	return <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, borderTop: "1px solid", borderColor: "divider", pl: 1 }}>
		<DriveButton color="inherit" aria-expanded={expanded} aria-label={`${item.appName}: ${who(item)}. ${expanded ? "Show less" : "Show more"}`} onClick={() => setExpanded((value) => !value)} sx={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textAlign: "left", py: 1 }}>
			<Box sx={{ minWidth: 0, width: "100%" }}>
				<Box sx={{ display: "flex", gap: 1, color: "text.secondary" }}>
					<Typography noWrap sx={{ fontSize: 19, flex: 1 }}>{item.appName}{item.conversation && item.conversation !== item.sender ? ` · ${item.conversation}` : ""}</Typography>
					<Typography sx={{ fontSize: 19, flexShrink: 0 }}>{timeAgo(item.time)}</Typography>
				</Box>
				<Typography noWrap={!expanded} sx={{ fontSize: 25, fontWeight: 700 }}>{who(item)}</Typography>
				{item.text && <Typography sx={{ fontSize: 22, color: "text.secondary", ...(expanded ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{item.text}</Typography>}
			</Box>
		</DriveButton>
		<DriveButton color="inherit" aria-label={`Read ${who(item)} aloud`} onClick={onRead} sx={{ minWidth: 0, flex: "0 0 72px", minHeight: 72 }}><VolumeUpRounded /></DriveButton>
		<DriveButton color="inherit" aria-label={`Dismiss ${who(item)}`} onClick={onDismiss} sx={{ minWidth: 0, flex: "0 0 72px", minHeight: 72, color: "text.secondary" }}><CloseRounded /></DriveButton>
	</Box>;
}

/** The pop-up for a new notification, and the list of recent ones that the status bar's phone button opens. */
export default function PhoneNotifications({ open, onOpen, onClose, quiet = false, onRead }: Props) {
	const phone = usePhoneLink();
	// Opening the list is what reads them, so the count goes back to nothing.
	useEffect(() => { if (open) phone.markAllRead(); }, [open, phone.items.length]);
	if (!phone.available) return null;
	if (!open) {
		return phone.toast && phone.settings.toasts && !quiet
			? <Toast item={phone.toast} showText={phone.settings.showText} onOpen={() => { phone.dismissToast(); onOpen(); }} onClose={phone.dismissToast} />
			: null;
	}
	return <Box role="region" aria-label="Phone notifications" sx={(theme) => ({ ...CARD(theme), position: "fixed", top: 56, right: 16, zIndex: 40, width: "min(680px, calc(100vw - 32px))", maxHeight: "calc(100vh - 220px)", display: "flex", flexDirection: "column", overflow: "hidden" })}>
		<Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: 2, pr: 0.5, py: 0.5 }}>
			<PhoneAndroidRounded aria-hidden sx={{ color: phone.connection.connected ? "success.main" : "text.disabled" }} />
			<Box sx={{ flex: 1, minWidth: 0 }}>
				<Typography sx={{ fontSize: 26, fontWeight: 800 }}>Phone</Typography>
				<Typography noWrap sx={{ fontSize: 19, color: "text.secondary" }}>{phone.connection.connected ? `Connected${phone.connection.device ? ` to ${phone.connection.device}` : ""}` : "Not connected. Notifications will return when the phone does."}</Typography>
			</Box>
			{phone.items.length > 0 && <DriveButton color="inherit" onClick={phone.clearAll} sx={{ minHeight: 64, px: 2, fontSize: 21 }}>Clear all</DriveButton>}
			<DriveButton color="inherit" aria-label="Close" onClick={onClose} sx={{ minWidth: 0, flex: "0 0 64px", minHeight: 64 }}><CloseRounded /></DriveButton>
		</Box>
		<Box sx={{ overflowY: "auto" }}>
			{phone.items.length === 0
				? <Typography sx={{ px: 2, py: 3, fontSize: 23, color: "text.secondary" }}>No notifications.</Typography>
				: phone.items.map((item) => <Row key={item.key} item={item} onRead={() => onRead(spokenNotification(item))} onDismiss={() => phone.dismiss(item.key)} />)}
		</Box>
	</Box>;
}
