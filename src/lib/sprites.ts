/**
 * The arcade's pixel art, from the sheet of its sprites: drawn as rows of characters ('.' nothing, 'X' the main colour, 'W' the
 * arcade's white, 'P' the one other colour: a ghost's pupils, a frightened ghost's face), made into 3D by lib/voxels.ts.
 * Generated; the ghosts are Blinky's, which the others share in other colours.
 */
export interface Sprite {
	rows: readonly string[];
	/** The main colour, as 0xRRGGBB. */
	body: number;
	/** The colour of 'P', or null if the sprite has none. */
	pupil: number | null;
}

/** The arcade's white, as the ghosts' eyes and the frightened ghost's flashes are drawn. */
export const ARCADE_WHITE = 0xdedeff;

/** The ghosts' body colours. */
export const GHOST_COLOURS = { blinky: 0xff0000, pinky: 0xffb7ff, inky: 0x00ffff, clyde: 0xffb751 } as const;

/** A ghost looking each way on the screen, in its two foot positions. */
export type Direction = "right" | "left" | "up" | "down";
export const GHOST_SPRITES: Record<Direction, readonly [Sprite, Sprite]> = {
	right: [
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXWWXXXXWWX.",
			".XXWWWWXXWWWW.",
			".XXWWPPXXWWPP.",
			"XXXWWPPXXWWPPX",
			"XXXXWWXXXXWWXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XX.XXX..XXX.XX",
			"X...XX..XX...X",
		], body: 0xff0000, pupil: 0x2121ff },
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXWWXXXXWWX.",
			".XXWWWWXXWWWW.",
			".XXWWPPXXWWPP.",
			"XXXWWPPXXWWPPX",
			"XXXXWWXXXXWWXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXX.XXXX.XXXX",
			".XX...XX...XX.",
		], body: 0xff0000, pupil: 0x2121ff },
	],
	left: [
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XWWXXXXWWXXX.",
			".WWWWXXWWWWXX.",
			".PPWWXXPPWWXX.",
			"XPPWWXXPPWWXXX",
			"XXWWXXXXWWXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XX.XXX..XXX.XX",
			"X...XX..XX...X",
		], body: 0xff0000, pupil: 0x2121ff },
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XWWXXXXWWXXX.",
			".WWWWXXWWWWXX.",
			".PPWWXXPPWWXX.",
			"XPPWWXXPPWWXXX",
			"XXWWXXXXWWXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXX.XXXX.XXXX",
			".XX...XX...XX.",
		], body: 0xff0000, pupil: 0x2121ff },
	],
	up: [
		{ rows: [
			".....XXXX.....",
			"...PPXXXXPP...",
			"..WPPWXXWPPW..",
			".XWWWWXXWWWWX.",
			".XWWWWXXWWWWX.",
			".XXWWXXXXWWXX.",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XX.XXX..XXX.XX",
			"X...XX..XX...X",
		], body: 0xff0000, pupil: 0x2121ff },
		{ rows: [
			".....XXXX.....",
			"...PPXXXXPP...",
			"..WPPWXXWPPW..",
			".XWWWWXXWWWWX.",
			".XWWWWXXWWWWX.",
			".XXWWXXXXWWXX.",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXX.XXXX.XXXX",
			".XX...XX...XX.",
		], body: 0xff0000, pupil: 0x2121ff },
	],
	down: [
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXXXXXXXXXX.",
			".XXWWXXXXWWXX.",
			".XWWWWXXWWWWX.",
			"XXWWWWXXWWWWXX",
			"XXWPPWXXWPPWXX",
			"XXXPPXXXXPPXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XX.XXX..XXX.XX",
			"X...XX..XX...X",
		], body: 0xff0000, pupil: 0x2121ff },
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXXXXXXXXXX.",
			".XXWWXXXXWWXX.",
			".XWWWWXXWWWWX.",
			"XXWWWWXXWWWWXX",
			"XXWPPWXXWPPWXX",
			"XXXPPXXXXPPXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXXX.XXXX.XXXX",
			".XX...XX...XX.",
		], body: 0xff0000, pupil: 0x2121ff },
	],
};

/** A frightened ghost: blue and white (flashing), each in its two foot positions. */
export const FRIGHTENED_SPRITES: { blue: readonly [Sprite, Sprite]; white: readonly [Sprite, Sprite] } = {
	blue: [
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXXXXXXXXXX.",
			".XXXXXXXXXXXX.",
			".XXXPPXXPPXXX.",
			"XXXXPPXXPPXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXPPXXPPXXPPXX",
			"XPXXPPXXPPXXPX",
			"XXXXXXXXXXXXXX",
			"XX.XXX..XXX.XX",
			"X...XX..XX...X",
		], body: 0x2121ff, pupil: 0xffb7ae },
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXXXXXXXXXX.",
			".XXXXXXXXXXXX.",
			".XXXPPXXPPXXX.",
			"XXXXPPXXPPXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXPPXXPPXXPPXX",
			"XPXXPPXXPPXXPX",
			"XXXXXXXXXXXXXX",
			"XXXX.XXXX.XXXX",
			".XX...XX...XX.",
		], body: 0x2121ff, pupil: 0xffb7ae },
	],
	white: [
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXXXXXXXXXX.",
			".XXXXXXXXXXXX.",
			".XXXPPXXPPXXX.",
			"XXXXPPXXPPXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXPPXXPPXXPPXX",
			"XPXXPPXXPPXXPX",
			"XXXXXXXXXXXXXX",
			"XX.XXX..XXX.XX",
			"X...XX..XX...X",
		], body: 0xdedeff, pupil: 0xff0000 },
		{ rows: [
			".....XXXX.....",
			"...XXXXXXXX...",
			"..XXXXXXXXXX..",
			".XXXXXXXXXXXX.",
			".XXXXXXXXXXXX.",
			".XXXPPXXPPXXX.",
			"XXXXPPXXPPXXXX",
			"XXXXXXXXXXXXXX",
			"XXXXXXXXXXXXXX",
			"XXPPXXPPXXPPXX",
			"XPXXPPXXPPXXPX",
			"XXXXXXXXXXXXXX",
			"XXXX.XXXX.XXXX",
			".XX...XX...XX.",
		], body: 0xdedeff, pupil: 0xff0000 },
	],
};

/** Pac-Man facing right: mouth wide open, half open, closed. */
export const PACMAN_FRAMES: readonly Sprite[] = [
	{ rows: [
		"....XXXXX....",
		"..XXXXXXX....",
		".XXXXXXX.....",
		".XXXXXX......",
		"XXXXXX.......",
		"XXXXX........",
		"XXXX.........",
		"XXXXX........",
		"XXXXXX.......",
		".XXXXXX......",
		".XXXXXXX.....",
		"..XXXXXXX....",
		"....XXXXX....",
	], body: 0xffff00, pupil: null },
	{ rows: [
		"....XXXXX....",
		"..XXXXXXXXX..",
		".XXXXXXXXXXX.",
		".XXXXXXXXXXX.",
		"XXXXXXXXXX...",
		"XXXXXXX......",
		"XXXX.........",
		"XXXXXXX......",
		"XXXXXXXXXX...",
		".XXXXXXXXXXX.",
		".XXXXXXXXXXX.",
		"..XXXXXXXXX..",
		"....XXXXX....",
	], body: 0xffff00, pupil: null },
	{ rows: [
		"....XXXXX....",
		"..XXXXXXXXX..",
		".XXXXXXXXXXX.",
		".XXXXXXXXXXX.",
		"XXXXXXXXXXXXX",
		"XXXXXXXXXXXXX",
		"XXXXXXXXXXXXX",
		"XXXXXXXXXXXXX",
		"XXXXXXXXXXXXX",
		".XXXXXXXXXXX.",
		".XXXXXXXXXXX.",
		"..XXXXXXXXX..",
		"....XXXXX....",
	], body: 0xffff00, pupil: null },
];

/** The arcade's pellets, as 'X' blocks of one colour: a dot is 2 by 2, a power pellet an 8 by 8 octagon. */
export const PELLET_COLOUR = 0xfab9b0;
export const DOT_SPRITE: readonly string[] = ["XX","XX"];
export const POWER_PELLET_SPRITE: readonly string[] = ["..XXXX..",".XXXXXX.","XXXXXXXX","XXXXXXXX","XXXXXXXX","XXXXXXXX",".XXXXXX.","..XXXX.."];
