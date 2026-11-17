import { PRONUNCIATIONS } from "./pronunciations";

/** Street-type abbreviations that always mean the same word. */
const ABBREVIATIONS: Record<string, string> = {
	Rd: "Road", Ave: "Avenue", Av: "Avenue", Blvd: "Boulevard", Cres: "Crescent", Cl: "Close", Ct: "Court",
	Cct: "Circuit", Esp: "Esplanade", Hwy: "Highway", Ln: "Lane", Pde: "Parade", Pl: "Place", Tce: "Terrace",
	Sq: "Square", Fwy: "Freeway", Mwy: "Motorway", Pwy: "Parkway", Wy: "Way", Gdns: "Gardens", Gr: "Grove",
	Nth: "North", Sth: "South",
};
const ABBREVIATION_PATTERN = new RegExp(`\\b(${Object.keys(ABBREVIATIONS).join("|")})\\b`, "g");

const COMPASS: Record<string, string> = { N: "North", S: "South", E: "East", W: "West", NE: "North East", NW: "North West", SE: "South East", SW: "South West" };
const STREET_WORDS = "Road|Street|Avenue|Highway|Drive|Way|Lane|Place|Terrace|Crescent|Parade|Motorway|Freeway|Boulevard|Esplanade|Close|Circuit|Court|Square";

const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

// The names are compiled once. Each vowel may carry a macron or not, so "Taupō" and "Taupo" both match.
const MACRON: Record<string, string> = { a: "[aā]", e: "[eē]", i: "[iī]", o: "[oō]", u: "[uū]" };
const NAMES = Object.entries(PRONUNCIATIONS)
	.sort(([a], [b]) => b.length - a.length)
	.map(([name, sounds]) => {
		const stripped = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
		const pattern = [...stripped].map((letter) => (letter === " " ? "\\s+" : MACRON[letter.toLowerCase()] ?? letter)).join("");
		return { pattern: new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, "giu"), sounds };
	});

/** Replaces place names the voice gets wrong with how they should sound. */
export function applyPronunciations(text: string): string {
	let out = text;
	for (const { pattern, sounds } of NAMES) out = out.replace(pattern, sounds);
	return out;
}

/**
 * Turns a routing instruction into text the voice reads well: abbreviations spelled out
 * ("Rd" → "Road", "SH1" → "State Highway 1"), American units made metric-British, ordinals as
 * words, bracketed extras dropped and local place names respelled.
 */
export function toSpeech(input: string): string {
	let text = input.replace(/\u00a0/g, " ");
	text = text.replace(/\s*\([^)]*\)/g, "");
	text = text.replace(/\s*&\s*/g, " and ");
	text = text.replace(/\bkilometers\b/gi, "kilometres").replace(/\bkilometer\b/gi, "kilometre").replace(/\bmeters\b/gi, "metres").replace(/\bmeter\b/gi, "metre");
	text = text.replace(/\b(?:SH|S\.H\.)\s?-?(\d+[A-Z]?)\b/g, "State Highway $1");
	text = text.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (match, digits: string) => ORDINALS[Number(digits)] || match);
	// "St", "Dr" and "Mt" are a name's first word when a capitalised word follows ("St Asaph"), otherwise a street type.
	text = text.replace(/\bSt\b\.?(?=\s+[A-Z])/g, "Saint").replace(/\bDr\b\.?(?=\s+[A-Z])/g, "Doctor").replace(/\bMt\b\.?/g, "Mount");
	text = text.replace(/\bSt\b/g, "Street").replace(/\bDr\b/g, "Drive");
	text = text.replace(ABBREVIATION_PATTERN, (abbreviation) => ABBREVIATIONS[abbreviation]);
	text = text.replace(new RegExp(`(?<=\\b(?:${STREET_WORDS}|\\d)\\s)(N|S|E|W|NE|NW|SE|SW)\\b(?=[\\s.,]|$)`, "g"), (letters) => COMPASS[letters]);
	text = applyPronunciations(text);
	return text.replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").trim();
}
