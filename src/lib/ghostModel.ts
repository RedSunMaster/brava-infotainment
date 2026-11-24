import * as THREE from "three";
import { ARCADE_WHITE, FRIGHTENED_SPRITES, GHOST_COLOURS, GHOST_SPRITES, type Direction, type Sprite } from "./sprites";
import { spriteVoxels, voxelMesh, type VoxelLook } from "./voxels";

/**
 * An arcade ghost in 3D pixel art: the arcade's own sprites, every pixel a block, a couple of blocks thick. The eyes stand a
 * block proud of the body and the pupils another. The sprite for the way it is looking (right, left, up or down on the
 * screen) is shown, in whichever of its two foot positions comes now. It stands in the model's X-Y plane with its face to
 * +Z and its back on z = 0, 2 units across, centred on the origin. After a power pellet it turns blue (and, near the end of
 * that, flashes blue and white), facing no way in particular, as the arcade's frightened ghosts do.
 */
const SIZE = 14;
const UNIT = 2 / SIZE;
const LOOK: VoxelLook = { unit: UNIT, columns: SIZE, rows: SIZE };
/** How many blocks thick each part is: the body, the whites of the eyes, the pupils. */
const THICKNESS = { X: 2, W: 3, P: 4 };
/** How often the feet swap, per second, and how often a flashing ghost changes colour. */
const FEET_PER_SECOND = 6;
const FLASHES_PER_SECOND = 4;
/** How many blocks thick a frightened ghost's body and its face are. */
const FRIGHTENED_THICKNESS = { X: 2, P: 3 };

/** Whether a ghost is chasing, running (blue) or running and about to turn back (flashing). */
export type Mood = "chasing" | "frightened" | "flashing";

export interface GhostModel {
	group: THREE.Group;
	/** Swaps the feet; `seconds` is any steadily increasing time. */
	update: (seconds: number) => void;
	/** Turns the ghost to look along (x, y) on the screen (x to the right, y up): whichever way is nearest; (0, 0) leaves it as it was. */
	look: (x: number, y: number) => void;
	/** Chasing, or blue (frightened), or flashing blue and white. */
	setMood: (mood: Mood) => void;
	dispose: () => void;
}

export function createGhost(colour: number = GHOST_COLOURS.blinky): GhostModel {
	const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
	const box = new THREE.BoxGeometry(1, 1, 1);
	const group = new THREE.Group();
	const meshes = {} as Record<Direction, THREE.InstancedMesh[]>;
	const build = (sprite: Sprite): THREE.InstancedMesh => {
		const voxels = spriteVoxels(sprite, { X: { count: THICKNESS.X, colour }, W: { count: THICKNESS.W, colour: ARCADE_WHITE }, P: { count: THICKNESS.P } });
		const mesh = voxelMesh(voxels, LOOK, box, material);
		mesh.visible = false;
		group.add(mesh);
		return mesh;
	};
	for (const direction of Object.keys(GHOST_SPRITES) as Direction[]) meshes[direction] = GHOST_SPRITES[direction].map(build);
	// A frightened ghost: blue, and white for the flashes, each in its two foot positions.
	const frightened = (sprites: readonly [Sprite, Sprite]): THREE.InstancedMesh[] => sprites.map(sprite => {
		const mesh = voxelMesh(spriteVoxels(sprite, { X: { count: FRIGHTENED_THICKNESS.X }, P: { count: FRIGHTENED_THICKNESS.P } }), LOOK, box, material);
		mesh.visible = false;
		group.add(mesh);
		return mesh;
	});
	const blue = frightened(FRIGHTENED_SPRITES.blue), white = frightened(FRIGHTENED_SPRITES.white);
	let direction: Direction = "right", frame = 0, mood: Mood = "chasing", seconds = 0;
	const show = (): void => {
		const flashWhite = mood === "flashing" && Math.floor(seconds * FLASHES_PER_SECOND) % 2 === 1;
		for (const [name, pair] of Object.entries(meshes)) pair.forEach((mesh, i) => { mesh.visible = mood === "chasing" && name === direction && i === frame; });
		blue.forEach((mesh, i) => { mesh.visible = mood !== "chasing" && !flashWhite && i === frame; });
		white.forEach((mesh, i) => { mesh.visible = mood !== "chasing" && flashWhite && i === frame; });
	};
	show();
	return {
		group,
		look: (x: number, y: number) => {
			if (x === 0 && y === 0) return;
			const next: Direction = Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "up" : "down");
			if (next !== direction) { direction = next; show(); }
		},
		setMood: (next: Mood) => { if (next !== mood) { mood = next; show(); } },
		update: (time: number) => {
			seconds = time;
			frame = Math.floor(time * FEET_PER_SECOND) % 2;
			show();
		},
		dispose: () => { box.dispose(); material.dispose(); [...Object.values(meshes).flat(), ...blue, ...white].forEach(mesh => mesh.dispose()); },
	};
}
