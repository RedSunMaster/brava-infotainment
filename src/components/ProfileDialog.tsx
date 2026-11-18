import React, { useState } from "react";
import { Box, Dialog, InputBase, Typography } from "@mui/material";
import AddRounded from "@mui/icons-material/AddRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import DriveButton from "./DriveButton";
import { useKeyboard } from "../contexts/KeyboardContext";
import { useProfiles } from "../contexts/ProfileContext";
import { AVATARS, COLOURS, MAX_NAME, MAX_PROFILES, type Profile } from "../lib/profiles";

/** A round avatar: the profile's emoji on a quiet neutral disc that follows the theme. */
export function Avatar({ profile, size = 40 }: { profile: Pick<Profile, "avatar">; size?: number }) {
	return <Box aria-hidden sx={{ width: size, height: size, borderRadius: "50%", bgcolor: "action.hover", border: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, lineHeight: 1, flexShrink: 0 }}>{profile.avatar}</Box>;
}

interface Props {
	open: boolean;
	onClose: () => void;
	/** Switching reloads the whole app, so it waits until navigation has ended. */
	lockSwitch: boolean;
	/** The car is moving: look only. */
	lockEdit: boolean;
}

type Editing = { id: string | null; name: string; avatar: string; color: string };

export default function ProfileDialog({ open, onClose, lockSwitch, lockEdit }: Props) {
	const { profiles, active, switchTo, create, update, remove } = useProfiles();
	const { showKeyboard, hideKeyboard } = useKeyboard();
	const [editing, setEditing] = useState<Editing | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const close = () => { hideKeyboard(); setEditing(null); setConfirmDelete(false); onClose(); };
	const startEdit = (next: Editing) => { setConfirmDelete(false); setEditing(next); };
	const save = () => {
		if (!editing || !editing.name.trim()) return;
		hideKeyboard();
		if (editing.id) update(editing.id, { name: editing.name, avatar: editing.avatar, color: editing.color });
		else create(editing.name, editing.avatar, editing.color);
		setEditing(null);
	};
	const nextColour = () => COLOURS[profiles.length % COLOURS.length];

	return (
		<Dialog open={open} onClose={close} fullWidth maxWidth="sm" disableEnforceFocus aria-labelledby="profile-title"
			sx={{ "& .MuiDialog-container": { alignItems: "flex-start" } }} slotProps={{ paper: { sx: { mt: 6, borderRadius: 3, backgroundImage: "none" } } }}>
			<Box sx={{ p: 2.5, display: "grid", gap: 2 }}>
				<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
					<Typography id="profile-title" sx={{ flex: 1, fontSize: 30, fontWeight: 800 }}>{editing ? (editing.id ? "Edit profile" : "New profile") : "Driver profiles"}</Typography>
					{!editing && <DriveButton color="inherit" onClick={close} sx={{ minHeight: 64, px: 3 }}>Done</DriveButton>}
				</Box>

				{!editing ? <>
					{lockSwitch && <Typography sx={{ fontSize: 20, color: "text.secondary" }}>{lockEdit ? "Stop driving to change profiles." : "End navigation to switch profiles."}</Typography>}
					<Box sx={{ display: "grid", gap: 1 }}>
						{profiles.map(profile => {
							const isActive = profile.id === active.id;
							return <Box key={profile.id} sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1, borderRadius: 3, border: "2px solid", borderColor: isActive ? "primary.main" : "divider" }}>
								<Avatar profile={profile} size={56} />
								<Box sx={{ flex: 1, minWidth: 0 }}>
									<Typography noWrap sx={{ fontSize: 26, fontWeight: 700 }}>{profile.name}</Typography>
									{isActive && <Typography sx={{ fontSize: 18, color: "primary.main", fontWeight: 700 }}>Driving now</Typography>}
								</Box>
								{!isActive && <DriveButton variant="contained" disabled={lockSwitch} aria-label={`Switch to ${profile.name}`} onClick={() => { close(); switchTo(profile.id); }} sx={{ minHeight: 64, px: 3 }}>Switch</DriveButton>}
								<DriveButton color="inherit" variant="outlined" disabled={lockEdit} aria-label={`Edit ${profile.name}`} onClick={() => startEdit({ id: profile.id, name: profile.name, avatar: profile.avatar, color: profile.color })} sx={{ minWidth: 64, minHeight: 64, p: 0 }}><EditRounded /></DriveButton>
							</Box>;
						})}
					</Box>
					<DriveButton variant="outlined" color="inherit" disabled={lockEdit || profiles.length >= MAX_PROFILES} startIcon={<AddRounded />} onClick={() => startEdit({ id: null, name: "", avatar: AVATARS[profiles.length % AVATARS.length], color: nextColour() })} sx={{ minHeight: 72 }}>Add profile</DriveButton>
					<Typography sx={{ fontSize: 18, color: "text.secondary" }}>Each profile keeps its own climate, favourites, saved places, voice, route and map settings.</Typography>
				</> : <>
					<Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
						<Avatar profile={editing} size={72} />
						<InputBase autoFocus fullWidth placeholder="Name" value={editing.name} inputProps={{ inputMode: "none", maxLength: MAX_NAME, "aria-label": "Profile name" }}
							onChange={e => setEditing({ ...editing, name: e.target.value })} onFocus={() => showKeyboard(save)} onClick={() => showKeyboard(save)}
							sx={{ flex: 1, fontSize: 30, fontWeight: 700, px: 2, py: 1, borderRadius: 2, bgcolor: "rgba(127,127,127,0.15)" }} />
					</Box>
					<Box role="group" aria-label="Icon" sx={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1 }}>
						{AVATARS.map(avatar => <DriveButton key={avatar} color="inherit" aria-pressed={editing.avatar === avatar} aria-label={`Icon ${avatar}`} onClick={() => setEditing({ ...editing, avatar })} sx={{ minWidth: 0, minHeight: 64, p: 0, fontSize: 32, border: "2px solid", borderColor: editing.avatar === avatar ? "primary.main" : "divider" }}>{avatar}</DriveButton>)}
					</Box>
					<Box sx={{ display: "flex", gap: 1 }}>
						{editing.id && profiles.length > 1 && editing.id !== active.id && (confirmDelete
							? <DriveButton color="error" variant="contained" onClick={() => { remove(editing.id!); setEditing(null); setConfirmDelete(false); }} sx={{ minHeight: 72 }}>Delete for good?</DriveButton>
							: <DriveButton color="error" variant="outlined" onClick={() => setConfirmDelete(true)} sx={{ minHeight: 72 }}>Delete</DriveButton>)}
						<Box sx={{ flex: 1 }} />
						<DriveButton color="inherit" onClick={() => { hideKeyboard(); setEditing(null); setConfirmDelete(false); }} sx={{ minHeight: 72, px: 3 }}>Cancel</DriveButton>
						<DriveButton variant="contained" disabled={!editing.name.trim()} onClick={save} sx={{ minHeight: 72, px: 4 }}>Save</DriveButton>
					</Box>
				</>}
			</Box>
		</Dialog>
	);
}
