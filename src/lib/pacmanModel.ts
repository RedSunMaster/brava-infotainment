import * as THREE from "three";
import { PACMAN_FRAMES } from "./sprites";
import { spriteVoxels, voxelMesh, type VoxelLook } from "./voxels";

/**
 * The Pac-Man car in 3D pixel art: the arcade's own sprite, every pixel a block, two blocks thick, lying flat on the ground
 * (the map is always seen from above in this mode). The sprite faces right; here its right is the front of the model, +Z, so
 * the car's heading turns it as the arcade turned Pac-Man. It chomps through the arcade's frames: closed, half open, wide
 * open, half open.
 */
export const PACMAN_RADIUS = 3;
/** The sprite is 13 pixels across. */
const SIZE = 13;
const UNIT = (2 * PACMAN_RADIUS) / SIZE;
const LOOK: VoxelLook = { unit: UNIT, columns: SIZE, rows: SIZE };
const THICKNESS = 2;
/** The order the frames come in while it chomps (PACMAN_FRAMES is wide, half, closed), and the one it rests on when parked. */
const CYCLE = [2, 1, 0, 1];
const RESTING = 1;

export interface PacmanModel {
	group: THREE.Group;
	/** Moves the chomp on by `dt` seconds; it chomps faster the faster the car goes. */
	update: (dt: number, speedMs: number) => void;
	dispose: () => void;
}

/**
 * The raw colour of a screen colour: the car's canvas shows colours as they are given, with no conversion for the
 * screen, so these are given as the screen colours they are meant to be.
 */
const screen = (hex: number): THREE.Color => new THREE.Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, THREE.LinearSRGBColorSpace);

export function createPacman(): PacmanModel {
	const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
	const box = new THREE.BoxGeometry(1, 1, 1);
	const frames = PACMAN_FRAMES.map(sprite => voxelMesh(spriteVoxels(sprite, { X: { count: THICKNESS }, P: { count: THICKNESS + 1 } }), LOOK, box, material, "ground", screen));
	const group = new THREE.Group();
	frames.forEach((mesh, i) => { mesh.visible = i === RESTING; group.add(mesh); });
	// Lit from above and in front, so the blocks' sides show as in the arcade's 3D renderings.
	group.add(new THREE.AmbientLight(0xffffff, 2.0));
	const sun = new THREE.DirectionalLight(0xffffff, 1.4);
	sun.position.set(-1, 3, 2);
	group.add(sun);
	group.visible = false;

	let phase = 0, shown = RESTING;
	const show = (frame: number): void => { if (frame === shown) return; shown = frame; frames.forEach((mesh, i) => { mesh.visible = i === frame; }); };
	return {
		group,
		update: (dt: number, speedMs: number) => {
			// Parked it rests half open; at speed it chomps a few times a second, quicker the faster it goes.
			if (speedMs <= 0.5) { show(RESTING); return; }
			phase += dt * (6 + Math.min(speedMs, 30) * 0.4);
			show(CYCLE[Math.floor(phase) % CYCLE.length]);
		},
		dispose: () => { box.dispose(); material.dispose(); frames.forEach(mesh => mesh.dispose()); },
	};
}
