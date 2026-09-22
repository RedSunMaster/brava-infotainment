import {
	StraightRounded,
	TurnSlightRightRounded,
	TurnRightRounded,
	TurnSharpRightRounded,
	UTurnRightRounded,
	UTurnLeftRounded,
	TurnSharpLeftRounded,
	TurnLeftRounded,
	TurnSlightLeftRounded,
	RoundaboutLeftRounded,
	RoundaboutRightRounded,
	FlagRounded,
	NavigationRounded,
	RampRightRounded,
	RampLeftRounded,
	ForkRightRounded,
	ForkLeftRounded,
	MergeRounded,
} from "@mui/icons-material";
import type { SvgIconProps } from "@mui/material";
import type { ComponentType } from "react";
import type { NormalizedManeuver } from "./routing";

type Icon = ComponentType<SvgIconProps>;

const valhallaIcons: Record<number, Icon> = {
	0: StraightRounded,
	1: NavigationRounded,
	4: FlagRounded,
	8: StraightRounded,
	9: TurnSlightRightRounded,
	10: TurnRightRounded,
	11: TurnSharpRightRounded,
	12: UTurnRightRounded,
	13: UTurnLeftRounded,
	14: TurnSharpLeftRounded,
	15: TurnLeftRounded,
	16: TurnSlightLeftRounded,
	17: StraightRounded,
	18: RampRightRounded,
	19: RampLeftRounded,
	20: RampRightRounded,
	21: RampLeftRounded,
	24: MergeRounded,
	25: ForkRightRounded,
	26: RoundaboutLeftRounded,
	27: RoundaboutLeftRounded,
};

const mapboxTypeIcons: Record<string, Icon> = {
	depart: NavigationRounded,
	arrive: FlagRounded,
	roundabout: RoundaboutLeftRounded,
	rotary: RoundaboutLeftRounded,
	merge: MergeRounded,
	fork: ForkRightRounded,
	"on ramp": RampRightRounded,
	"off ramp": RampRightRounded,
	continue: StraightRounded,
	turn: StraightRounded,
};

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

function textFor(maneuver: NormalizedManeuver): string {
	return `${maneuver.instruction ?? ""} ${maneuver.modifier ?? ""}`.toLowerCase();
}

function isLeft(maneuver: NormalizedManeuver): boolean {
	return textFor(maneuver).includes("left");
}

function isRight(maneuver: NormalizedManeuver): boolean {
	return textFor(maneuver).includes("right");
}

function directionIcon(
	maneuver: NormalizedManeuver,
	leftIcon: Icon,
	rightIcon: Icon,
	fallback: Icon,
): Icon {
	if (isLeft(maneuver)) return leftIcon;
	if (isRight(maneuver)) return rightIcon;
	return fallback;
}

function iconFromInstruction(maneuver: NormalizedManeuver): Icon | null {
	const text = textFor(maneuver);

	if (text.includes("roundabout") || text.includes("rotary")) {
		return directionIcon(
			maneuver,
			RoundaboutLeftRounded,
			RoundaboutRightRounded,
			RoundaboutLeftRounded,
		);
	}

	if (/\btake (the )?\d+(st|nd|rd|th) exit\b/.test(text)) {
		return directionIcon(
			maneuver,
			RoundaboutLeftRounded,
			RoundaboutRightRounded,
			RoundaboutLeftRounded,
		);
	}

	if (text.includes("fork")) {
		return directionIcon(
			maneuver,
			ForkLeftRounded,
			ForkRightRounded,
			ForkRightRounded,
		);
	}

	if (text.includes("merge")) return MergeRounded;

	if (text.includes("ramp") || text.includes("exit")) {
		return directionIcon(
			maneuver,
			RampLeftRounded,
			RampRightRounded,
			RampRightRounded,
		);
	}

	if (text.includes("keep left")) return TurnSlightLeftRounded;
	if (text.includes("keep right")) return TurnSlightRightRounded;

	return null;
}

export function getManeuverIcon(maneuver: NormalizedManeuver): Icon {
	const instructionIcon = iconFromInstruction(maneuver);
	if (instructionIcon) return instructionIcon;

	if (typeof maneuver.type === "number") {
		return valhallaIcons[maneuver.type] ?? StraightRounded;
	}

	if (typeof maneuver.type === "string") {
		if (maneuver.type === "roundabout" || maneuver.type === "rotary") {
			return directionIcon(
				maneuver,
				RoundaboutLeftRounded,
				RoundaboutRightRounded,
				mapboxTypeIcons[maneuver.type],
			);
		}

		if (maneuver.type === "fork") {
			return directionIcon(
				maneuver,
				ForkLeftRounded,
				ForkRightRounded,
				mapboxTypeIcons[maneuver.type],
			);
		}

		if (maneuver.type === "on ramp" || maneuver.type === "off ramp") {
			return directionIcon(
				maneuver,
				RampLeftRounded,
				RampRightRounded,
				mapboxTypeIcons[maneuver.type],
			);
		}

		if (maneuver.type === "merge") return MergeRounded;
	}

	if (typeof maneuver.modifier === "string") {
		return mapboxModifierIcons[maneuver.modifier] ?? StraightRounded;
	}

	if (typeof maneuver.type === "string") {
		return mapboxTypeIcons[maneuver.type] ?? StraightRounded;
	}

	return StraightRounded;
}
