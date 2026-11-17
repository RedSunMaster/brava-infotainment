/**
 * How to make the English voice say place names it would otherwise get wrong.
 *
 * The voice reads ordinary spelling, so each entry is a respelling in plain English sounds
 * (hyphens separate syllables). Names are matched with or without macrons, in any case.
 * Add a line when you hear a name said badly: the left side is how the map spells it, the right
 * side is how it should sound. Only names the voice gets wrong need to be here.
 */
export const PRONUNCIATIONS: Record<string, string> = {
	// Christchurch and Canterbury
	Papanui: "Pah-pah-noo-ee",
	Waimakariri: "Why-mah-kah-ree-ree",
	Rangiora: "Rang-ee-or-ah",
	Kaiapoi: "Ky-uh-poy",
	Opawa: "Oh-pah-wah",
	Waitaha: "Why-tah-hah",
	Ōtākaro: "Oh-tah-kah-roh",
	Waikuku: "Why-koo-koo",
	Akaroa: "Ack-uh-roa-uh",
	Kaikōura: "Ky-core-ah",
	Rakaia: "Ruh-kye-uh",
	Waitaki: "Why-tah-kee",
	Timaru: "Tim-uh-roo",
	Oamaru: "Oh-uh-mah-roo",
	Hororata: "Hor-oh-rah-tah",
	Wānaka: "Wah-nuh-kuh",
	"Te Anau": "Tay Ah-now",
	"Tai Tapu": "Tie Tah-poo",
	Ōtautahi: "Oh-tow-tah-hee",
	Aranui: "Ah-rah-noo-ee",
	// Elsewhere in New Zealand
	Aotearoa: "Ah-oh-tay-ah-roa",
	Waikato: "Why-kah-toe",
	Whangārei: "Fong-uh-ray",
	Whakatāne: "Fah-kuh-tah-nee",
	Rotorua: "Roh-toh-roo-uh",
	Taranaki: "Tah-rah-nah-kee",
	Whanganui: "Fong-uh-noo-ee",
	Manawatū: "Mah-nah-wah-too",
	Wairarapa: "Why-rah-rah-pah",
	Waitangi: "Why-tahng-ee",
	Paraparaumu: "Pah-rah-pah-rah-oo-moo",
	Waikanae: "Why-kah-nye",
	Ōtaki: "Oh-tah-kee",
	Porirua: "Por-ee-roo-uh",
	Petone: "Pet-oh-nee",
	Onehunga: "Oh-nay-hoong-uh",
	Papakura: "Pah-pah-koo-rah",
	Papatoetoe: "Pah-pah-toy-toy",
	Manukau: "Mah-noo-cow",
	Waitākere: "Why-tah-keh-ree",
	Takapuna: "Tah-kah-poo-nah",
	Pukekohe: "Pook-ee-koh-ee",
	Ōtāhuhu: "Oh-tah-hoo-hoo",
	Taumarunui: "Tow-mah-roo-noo-ee",
	Ōhakune: "Oh-hah-koo-nee",
	Tūrangi: "Too-rung-ee",
	Kerikeri: "Keh-ree-keh-ree",
	Whitianga: "Fit-ee-ung-ah",
	Wairoa: "Why-roa",
};
