import * as THREE from "three";
import { FRUIT_SPRITES } from "./fruitSprites";
import { voxelMesh, type Voxel, type VoxelLook } from "./voxels";

/**
 * A bonus fruit in 3D pixel art: the arcade's sprite, every pixel a block, three blocks thick. Like a ghost it stands in the
 * model's X-Y plane with its face to +Z, centred on the origin and about 2.4 units across.
 */
const SIZE = 16;
const LOOK: VoxelLook = { unit: 2.4 / SIZE, columns: SIZE, rows: SIZE };
const THICKNESS = 3;

export interface FruitModel { group: THREE.Group; dispose: () => void }

export function createFruit(kind: number): FruitModel {
	const sprite = FRUIT_SPRITES[Math.min(FRUIT_SPRITES.length - 1, Math.max(0, kind))];
	const voxels: Voxel[] = [];
	sprite.rows.forEach((text, row) => {
		for (let column = 0; column < text.length; column++) {
			const index = text.charCodeAt(column) - 97;
			if (index < 0 || index >= sprite.palette.length) continue;
			for (let layer = 0; layer < THICKNESS; layer++) voxels.push({ column, row, layer, colour: sprite.palette[index] });
		}
	});
	const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
	const box = new THREE.BoxGeometry(1, 1, 1);
	const mesh = voxelMesh(voxels, LOOK, box, material);
	const group = new THREE.Group();
	group.add(mesh);
	return { group, dispose: () => { box.dispose(); material.dispose(); mesh.dispose(); } };
}
