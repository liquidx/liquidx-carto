/**
 * Forest: low-poly firs scattered everywhere the ground mask allows, below the treeline,
 * as two instanced meshes (trunks and foliage), with a grid for collision lookups.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Ground } from './ground';
import type { LocalFrame } from './frame';
import type { Terrain } from './terrain';

/** Trees thin out from here and stop at the top of the band. */
const TREELINE = [1180, 1300];
/** Collision grid cell in metres. */
const GRID = 24;

export interface Forest {
	group: THREE.Group;
	count: number;
	/** The nearest tree within `radius` of world x, z as [x, z, trunk radius], if any. */
	nearest(x: number, z: number, radius: number): [number, number, number] | null;
	setShadows(on: boolean): void;
	dispose(): void;
}

function hash(ix: number, iz: number, salt: number) {
	let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Scatter trees on a jittered grid `spacing` metres apart. Positions are read from the terrain
 * as it is now (the coarse level), which is close enough: trunks are sunk a little.
 */
export function plantForest(
	frame: LocalFrame,
	terrain: Terrain,
	ground: Ground,
	spacing = 14
): Forest {
	const spots: number[] = [];
	const nx = Math.floor(frame.width / spacing);
	const nz = Math.floor(frame.height / spacing);
	for (let iz = 0; iz < nz; iz++) {
		for (let ix = 0; ix < nx; ix++) {
			const x = -frame.width / 2 + (ix + hash(ix, iz, 1)) * spacing;
			const z = -frame.height / 2 + (iz + hash(ix, iz, 2)) * spacing;
			if (!ground.treeAllowed(x, z)) continue;
			const y = terrain.height(x, z);
			const keep = Math.min(1, Math.max(0, (TREELINE[1] - y) / (TREELINE[1] - TREELINE[0])));
			if (hash(ix, iz, 3) > keep) continue;
			// Sparser on steep ground.
			const n = terrain.normal(x, z);
			if (n.y < 0.72 && hash(ix, iz, 5) > 0.5) continue;
			// Full-grown firs and beeches, 14 to 22 m tall, as a unit tree is 10 m.
			spots.push(x, y, z, 1.4 + hash(ix, iz, 4) * 0.8, hash(ix, iz, 6));
		}
	}
	const count = spots.length / 5;

	// One fir, ten metres tall: a trunk and three stacked open cones.
	const trunk = new THREE.CylinderGeometry(0.22, 0.3, 2.4, 5).translate(0, 1.2, 0);
	const cone = (r: number, h: number, y: number) =>
		new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0);
	const foliage = mergeGeometries([cone(2.1, 5.2, 1.6), cone(1.5, 4.6, 4.2), cone(0.85, 3.6, 6.6)]);
	const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 1 });
	const foliageMaterial = new THREE.MeshStandardMaterial({
		roughness: 0.95,
		flatShading: true,
		vertexColors: false
	});
	const trunks = new THREE.InstancedMesh(trunk, trunkMaterial, count);
	const crowns = new THREE.InstancedMesh(foliage, foliageMaterial, count);
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const turn = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const dark = new THREE.Color('#2f5a3a');
	const snowy = new THREE.Color('#9fb7a6');
	const tint = new THREE.Color();
	for (let i = 0; i < count; i++) {
		const [x, y, z, s, r] = spots.slice(i * 5, i * 5 + 5);
		position.set(x, y - 0.5, z);
		turn.setFromAxisAngle(up, r * Math.PI * 2);
		scale.set(s * (0.85 + r * 0.3), s, s * (0.85 + r * 0.3));
		matrix.compose(position, turn, scale);
		trunks.setMatrixAt(i, matrix);
		crowns.setMatrixAt(i, matrix);
		crowns.setColorAt(i, tint.copy(dark).lerp(snowy, r * 0.55));
	}
	trunks.frustumCulled = false;
	crowns.frustumCulled = false;

	// Collision grid.
	const cells = new Map<number, number[]>();
	const cols = Math.ceil(frame.width / GRID) + 1;
	const key = (x: number, z: number) =>
		Math.floor((z + frame.height / 2) / GRID) * cols + Math.floor((x + frame.width / 2) / GRID);
	for (let i = 0; i < count; i++) {
		const k = key(spots[i * 5], spots[i * 5 + 2]);
		const list = cells.get(k);
		if (list) list.push(i);
		else cells.set(k, [i]);
	}

	const group = new THREE.Group();
	group.add(trunks, crowns);
	return {
		group,
		count,
		nearest(x, z, radius) {
			let best: [number, number, number] | null = null;
			let bestD = radius;
			for (let dz = -1; dz <= 1; dz++)
				for (let dx = -1; dx <= 1; dx++) {
					const list = cells.get(key(x + dx * GRID, z + dz * GRID));
					if (!list) continue;
					for (const i of list) {
						const tx = spots[i * 5];
						const tz = spots[i * 5 + 2];
						const r = 0.35 * spots[i * 5 + 3];
						const d = Math.hypot(tx - x, tz - z) - r;
						if (d < bestD) {
							bestD = d;
							best = [tx, tz, r];
						}
					}
				}
			return best;
		},
		setShadows(on) {
			trunks.castShadow = crowns.castShadow = on;
		},
		dispose() {
			trunk.dispose();
			foliage.dispose();
			trunkMaterial.dispose();
			foliageMaterial.dispose();
			trunks.dispose();
			crowns.dispose();
		}
	};
}
