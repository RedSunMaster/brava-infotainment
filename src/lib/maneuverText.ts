const ORDINALS: Record<string, string> = {
	first: "1st",
	second: "2nd",
	third: "3rd",
	fourth: "4th",
	fifth: "5th",
	sixth: "6th",
	seventh: "7th",
	eighth: "8th",
};

/**
 * Shortens a routing instruction to what a driver can read in a glance.
 * The manoeuvre arrow already says "turn left", so the label is just the road
 * ("Millstream Drive"). Roundabouts keep the exit number, which the arrow
 * cannot show ("2nd exit · Main Street"). Anything that cannot be shortened
 * safely (arrival, unnamed roads) is returned unchanged.
 */
export function glanceLabel(instruction: string): string {
	const text = instruction.trim().replace(/\.$/, "");
	if (/\b(arrive|arrived|destination)\b/i.test(text)) return text;
	const road =
		text.match(/\bonto (.+)$/i)?.[1] ??
		text.match(/\b(?:on|toward|towards) (?!the\b)(.+)$/i)?.[1];
	const exit = text.match(/\btake the (\w+) exit\b/i)?.[1]?.toLowerCase();
	if (exit) {
		const ordinal = ORDINALS[exit] ?? exit;
		return road ? `${ordinal} exit · ${road}` : `${ordinal} exit`;
	}
	return road ?? text;
}
