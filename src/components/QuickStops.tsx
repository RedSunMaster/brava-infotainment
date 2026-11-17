import React from "react";
import { Box } from "@mui/material";
import LocalGasStationRounded from "@mui/icons-material/LocalGasStationRounded";
import EvStationRounded from "@mui/icons-material/EvStationRounded";
import RestaurantRounded from "@mui/icons-material/RestaurantRounded";
import LocalParkingRounded from "@mui/icons-material/LocalParkingRounded";
import DriveButton from "./DriveButton";
import { STOP_CATEGORIES, type StopCategoryId } from "../lib/stopCategories";

const ICONS: Record<StopCategoryId, React.ElementType> = {
 gas_station: LocalGasStationRounded,
 charging_station: EvStationRounded,
 food_and_drink: RestaurantRounded,
 parking: LocalParkingRounded,
};

interface Props { selected: string | null; onSelect: (category: StopCategoryId | null) => void }
/** One-tap stops along the route: fuel, charging, food and parking, as icon buttons that sit in the Add stop row. */
export default function QuickStops({ selected, onSelect }: Props) {
 return <Box role="group" aria-label="Find stops along route" sx={{ display: "contents" }}>
  {STOP_CATEGORIES.map(({ id, label }) => {
   const Icon = ICONS[id];
   const active = selected === id;
   return <DriveButton key={id} aria-label={label} title={label} aria-pressed={active} className="map-action" variant={active ? "contained" : "text"} color={active ? "primary" : "inherit"} onClick={() => onSelect(active ? null : id)} sx={{ minWidth: 0, p: 0, flex: "0 0 var(--map-target)" }}>
    <Icon aria-hidden sx={{ fontSize: 36, color: active ? "inherit" : "primary.main" }} />
   </DriveButton>;
  })}
 </Box>;
}
