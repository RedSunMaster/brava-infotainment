import React from "react";
import { Box } from "@mui/material";
import HomeRounded from "@mui/icons-material/HomeRounded";
import WorkRounded from "@mui/icons-material/WorkRounded";
import PlaceRounded from "@mui/icons-material/PlaceRounded";
import DriveButton from "./DriveButton";
import type { Coordinates } from "../lib/locationSearch";
import type { PlaceSlot, SavedPlaces } from "../lib/savedPlaces";

interface Props {
	saved: SavedPlaces;
	/** Most-visited places, already excluding Home and Work. */
	frequent: { name: string; coords: Coordinates; buildingCoords?: Coordinates }[];
	onGo: (coords: Coordinates, name: string, buildingCoords?: Coordinates) => void;
	onSet: (slot: PlaceSlot) => void;
	disabled?: boolean;
}

const SLOTS = [
	{ slot: "home", label: "Home", Icon: HomeRounded },
	{ slot: "work", label: "Work", Icon: WorkRounded },
] as const;

/** One-tap destinations on the idle screen: Home, Work and the top frequent places. */
export default function QuickDestinations({ saved, frequent, onGo, onSet, disabled }: Props) {
	const buttonSx = {
		minWidth: 0,
		flexDirection: "column",
		gap: 0.25,
		px: 1,
		fontSize: 24,
		bgcolor: "background.paper",
		boxShadow: 2,
		borderRadius: 3,
		"&:hover": { bgcolor: "surface.main" },
	} as const;
	const labelSx = { maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
	return (
		<Box role="group" aria-label="Saved destinations" sx={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(0, 1fr)", gap: 1, color: "text.primary" }}>
			{SLOTS.map(({ slot, label, Icon }) => {
				const place = saved[slot];
				return (
					<DriveButton key={slot} color="inherit" disabled={disabled} aria-label={place ? `Navigate ${label.toLowerCase()}` : `Set ${label.toLowerCase()} address`} onClick={() => (place ? onGo(place.coords, place.name, place.buildingCoords) : onSet(slot))} sx={buttonSx}>
						<Icon />
						<Box component="span" sx={{ ...labelSx, color: place ? "inherit" : "text.secondary" }}>{place ? label : `Set ${label}`}</Box>
					</DriveButton>
				);
			})}
			{frequent.map((place) => (
				<DriveButton key={place.name + place.coords.join(",")} color="inherit" disabled={disabled} aria-label={`Navigate to ${place.name}`} onClick={() => onGo(place.coords, place.name, place.buildingCoords)} sx={buttonSx}>
					<PlaceRounded />
					<Box component="span" sx={labelSx}>{place.name.split(",")[0]}</Box>
				</DriveButton>
			))}
		</Box>
	);
}
