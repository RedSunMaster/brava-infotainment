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
/** One-tap stops along the route: fuel, charging, food and parking, shown as large icons. */
export default function QuickStops({ selected, onSelect }: Props) {
 return <Box role="group" aria-label="Find stops along route" sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 1, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3, p: 0.75 }}>
  {STOP_CATEGORIES.map(({ id, label }) => {
   const Icon = ICONS[id];
   const active = selected === id;
   return <DriveButton key={id} aria-label={label} title={label} aria-pressed={active} variant={active ? "contained" : "text"} color={active ? "primary" : "inherit"} onClick={() => onSelect(active ? null : id)} sx={{ minHeight: 64, minWidth: 0, p: 0 }}>
    <Icon aria-hidden sx={{ fontSize: 40, color: active ? "inherit" : "primary.main" }} />
   </DriveButton>;
  })}
 </Box>;
}
