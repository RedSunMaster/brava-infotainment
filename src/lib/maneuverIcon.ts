import StraightRounded from "@mui/icons-material/StraightRounded";
import TurnSlightRightRounded from "@mui/icons-material/TurnSlightRightRounded";
import TurnRightRounded from "@mui/icons-material/TurnRightRounded";
import TurnSharpRightRounded from "@mui/icons-material/TurnSharpRightRounded";
import UTurnRightRounded from "@mui/icons-material/UTurnRightRounded";
import UTurnLeftRounded from "@mui/icons-material/UTurnLeftRounded";
import TurnSharpLeftRounded from "@mui/icons-material/TurnSharpLeftRounded";
import TurnLeftRounded from "@mui/icons-material/TurnLeftRounded";
import TurnSlightLeftRounded from "@mui/icons-material/TurnSlightLeftRounded";
import RoundaboutLeftRounded from "@mui/icons-material/RoundaboutLeftRounded";
import RoundaboutRightRounded from "@mui/icons-material/RoundaboutRightRounded";
import FlagRounded from "@mui/icons-material/FlagRounded";
import NavigationRounded from "@mui/icons-material/NavigationRounded";
import RampRightRounded from "@mui/icons-material/RampRightRounded";
import RampLeftRounded from "@mui/icons-material/RampLeftRounded";
import ForkRightRounded from "@mui/icons-material/ForkRightRounded";
import ForkLeftRounded from "@mui/icons-material/ForkLeftRounded";
import MergeRounded from "@mui/icons-material/MergeRounded";
import type { SvgIconProps } from "@mui/material";
import type { ComponentType } from "react";

type Icon = ComponentType<SvgIconProps>;

const valhallaIcons: Record<number, Icon> = {
	0: StraightRounded, // none
	1: NearMeRounded, // start
	4: FlagRounded, // destination
	8: StraightRounded, // continue
	9: TurnSlightRightRounded, // slight right
	10: TurnRightRounded, // right
	11: TurnSharpRightRounded, // sharp right
	12: UTurnRightRounded, // u-turn right
	13: UTurnLeftRounded, // u-turn left
	14: TurnSharpLeftRounded, // sharp left
	15: TurnLeftRounded, // left
	16: TurnSlightLeftRounded, // slight left
	17: StraightRounded, // ramp straight
	18: RampRightRounded, // ramp right
	19: RampLeftRounded, // ramp left
	20: RampRightRounded, // exit right
	21: RampLeftRounded, // exit left
	26: RoundaboutRightRounded, // roundabout enter
	27: StraightRounded, // roundabout exit
};

const mapboxTypeIcons: Record<string, Icon> = {
	depart: NearMeRounded,
	arrive: FlagRounded,
	roundabout: RoundaboutRightRounded,
	rotary: RoundaboutRightRounded,
	merge: StraightRounded,
	fork: RampRightRounded,
	"on ramp": RampRightRounded,
	"off ramp": RampLeftRounded,
	continue: StraightRounded,
	turn: StraightRounded,
};
// Mapbox maneuver.modifier → icon
const mapboxModifierIcons: Record<string, Icon> = {
	straight: StraightRounded,
	"slight right": TurnSlightRightRounded,
	right: TurnRightRounded,
	"sharp right": TurnSharpRightRounded,
	uturn: UTurnRightRounded,
	"sharp left": TurnSharpLeftRounded,
	left: TurnLeftRounded,
	"slight left": TurnSlightLeftRounded,
};
export function getManeuverIcon(maneuver: any): Icon {
	// Valhalla — numeric type
	if (typeof maneuver.type === "number") {
		return valhallaIcons[maneuver.type] ?? StraightRounded;
	}

	// Mapbox — modifier takes priority over type
	if (typeof maneuver.modifier === "string") {
		return mapboxModifierIcons[maneuver.modifier] ?? StraightRounded;
	}

	// Mapbox — fall back to type icon (depart, arrive, roundabout etc.)
	if (typeof maneuver.type === "string") {
		return mapboxTypeIcons[maneuver.type] ?? StraightRounded;
	}

	return StraightRounded;
}
