import * as THREE from "three";
import type { Sprite } from "./sprites";

/**
 * Helpers for 3D pixel art: a sprite drawn on a grid, each filled square made a block, so the arcade's characters stand up
 * off the map as the solid, square-edged shapes they were drawn as.
 */

/** A block's place: column and row on the sprite's grid, which layer of blocks it is on (0 on the ground), and its colour. */
export interface Voxel { column: number; row: number; layer: number; colour: number }

export interface VoxelLook {
	/** Width of one block, in model units. */
	unit: number;
	/** The grid's width and height in blocks (so the sprite is centred on the origin). */
	columns: number;
	rows: number;
}

/**
 * How the sprite sits in the model:
 *  - "wall": in the X-Y plane (column to the right, row downwards), face to +Z, back on z = 0;
 *  - "ground": lying on the ground (back on y = 0, face up), turned so that the right of the sprite is the front of the
 *    model (+Z) and the top of the sprite is +X.
 */
export type Layout = "wall" | "ground";

/** The blocks of a sprite: for each character that is drawn, the layers its block is stacked up to and its colour. */
export function spriteVoxels(sprite: Sprite, layers: Partial<Record<"X" | "W" | "P", { count: number; colour?: number }>>): Voxel[] {
	const out: Voxel[] = [];
	sprite.rows.forEach((text, row) => {
		for (let column = 0; column < text.length; column++) {
			const kind = text[column] as "X" | "W" | "P" | ".";
			const rule = kind === "." ? undefined : layers[kind];
			if (!rule) continue;
			const colour = rule.colour ?? (kind === "X" ? sprite.body : kind === "W" ? 0xffffff : sprite.pupil ?? 0x000000);
			for (let layer = 0; layer < rule.count; layer++) out.push({ column, row, layer, colour });
		}
	});
	return out;
}

/** One mesh of blocks, one instance each, each in its own colour (the material should be white). */
export function voxelMesh(voxels: readonly Voxel[], look: VoxelLook, geometry: THREE.BufferGeometry, material: THREE.Material, layout: Layout = "wall", paint: (hex: number) => THREE.Color = hex => new THREE.Color(hex)): THREE.InstancedMesh {
	const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, voxels.length));
	const matrix = new THREE.Matrix4();
	voxels.forEach((voxel, i) => {
		const right = (voxel.column - (look.columns - 1) / 2) * look.unit;
		const up = ((look.rows - 1) / 2 - voxel.row) * look.unit;
		const height = (voxel.layer + 0.5) * look.unit;
		matrix.makeScale(look.unit, look.unit, look.unit);
		if (layout === "ground") matrix.setPosition(up, height, right);
		else matrix.setPosition(right, up, height);
		mesh.setMatrixAt(i, matrix);
		mesh.setColorAt(i, paint(voxel.colour));
	});
	mesh.count = voxels.length;
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
	mesh.frustumCulled = false;
	return mesh;
}
