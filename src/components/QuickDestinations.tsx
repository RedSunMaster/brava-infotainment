import React from "react";
import HomeRounded from "@mui/icons-material/HomeRounded";
import WorkRounded from "@mui/icons-material/WorkRounded";
import DriveButton from "./DriveButton";
import type { Coordinates } from "../lib/locationSearch";
import type { PlaceSlot, SavedPlaces } from "../lib/savedPlaces";

interface Props {
	saved: SavedPlaces;
	onGo: (coords: Coordinates, name: string, buildingCoords?: Coordinates) => void;
	onSet: (slot: PlaceSlot) => void;
	disabled?: boolean;
}

const SLOTS = [
	{ slot: "home", label: "home", Icon: HomeRounded },
	{ slot: "work", label: "work", Icon: WorkRounded },
] as const;

/**
 * Home and Work as two icon buttons that sit in the main control row. Tapping one navigates there
 * at once; one that is not set yet is dimmed and opens the address picker instead. Frequent places
 * live in the search panel, so they are not repeated here.
 */
export default function QuickDestinations({ saved, onGo, onSet, disabled }: Props) {
	return (
		<>
			{SLOTS.map(({ slot, label, Icon }) => {
				const place = saved[slot];
				return (
					<DriveButton
						key={slot}
						className="map-action"
						color="inherit"
						disabled={disabled}
						aria-label={place ? `Navigate ${label}` : `Set ${label} address`}
						onClick={() => (place ? onGo(place.coords, place.name, place.buildingCoords) : onSet(slot))}
						sx={{ opacity: place ? 1 : 0.55 }}
					>
						<Icon />
					</DriveButton>
				);
			})}
		</>
	);
}
