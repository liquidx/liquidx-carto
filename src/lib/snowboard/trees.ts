/**
 * Forest: trees scattered everywhere the ground mask allows, with a grid for collision lookups.
 * Every tree of the resort is planted, but in square chunks of instanced meshes, so the ones out
 * of view are culled and the far ones are drawn as a single cone; see `species.ts` for the trees.
 */
import * as THREE from 'three';
import type { Ground } from './ground';
import type { LocalFrame } from './frame';
import type { Terrain } from './terrain';
import { speciesChunks } from './species';

/**
 * Where there is no woods data to say, trees thin out from here and stop at the top of the
 * band: a guess at the treeline, in metres.
 */
const TREELINE = [1180, 1300];
/** The side of a chunk of forest, in metres. */
const CHUNK = 256;
/** Collision grid cell in metres. */
const GRID = 24;
/** Numbers per tree in `spots`: x, y, z, scale, and two random numbers. */
const STRIDE = 6;

export interface Forest {
	group: THREE.Group;
	count: number;
	/** The nearest tree within `radius` of world x, z as [x, z, trunk radius], if any. */
	nearest(x: number, z: number, radius: number): [number, number, number] | null;
	/** Pick what is drawn of each chunk for a camera at `eye`. Call every frame. */
	update(eye: THREE.Vector3): void;
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
			// The woods file knows where the forest ends; elsewhere the treeline is a guess.
			const keep = ground.woodsMapped(x, z)
				? 1
				: Math.min(1, Math.max(0, (TREELINE[1] - y) / (TREELINE[1] - TREELINE[0])));
			if (hash(ix, iz, 3) > keep) continue;
			// Sparser on steep ground.
			const n = terrain.normal(x, z);
			if (n.y < 0.72 && hash(ix, iz, 5) > 0.5) continue;
			// Full-grown firs and beeches, 14 to 22 m tall, as a unit tree is 10 m.
			spots.push(x, y, z, 1.4 + hash(ix, iz, 4) * 0.8, hash(ix, iz, 6), hash(ix, iz, 7));
		}
	}
	const count = spots.length / STRIDE;

	// Trees by chunk.
	const chunkCols = Math.ceil(frame.width / CHUNK);
	const members = new Map<number, number[]>();
	for (let i = 0; i < count; i++) {
		const k =
			Math.floor((spots[i * STRIDE + 2] + frame.height / 2) / CHUNK) * chunkCols +
			Math.floor((spots[i * STRIDE] + frame.width / 2) / CHUNK);
		const list = members.get(k);
		if (list) list.push(i);
		else members.set(k, [i]);
	}

	const lists = [...members.values()];
	const look = speciesChunks(spots, STRIDE, lists);
	const group = new THREE.Group();
	group.add(...look.meshes);

	// Collision grid.
	const cells = new Map<number, number[]>();
	const cols = Math.ceil(frame.width / GRID) + 1;
	const key = (x: number, z: number) =>
		Math.floor((z + frame.height / 2) / GRID) * cols + Math.floor((x + frame.width / 2) / GRID);
	for (let i = 0; i < count; i++) {
		const k = key(spots[i * STRIDE], spots[i * STRIDE + 2]);
		const list = cells.get(k);
		if (list) list.push(i);
		else cells.set(k, [i]);
	}

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
						const tx = spots[i * STRIDE];
						const tz = spots[i * STRIDE + 2];
						const r = 0.35 * spots[i * STRIDE + 3];
						const d = Math.hypot(tx - x, tz - z) - r;
						if (d < bestD) {
							bestD = d;
							best = [tx, tz, r];
						}
					}
				}
			return best;
		},
		update(eye) {
			look.update(eye);
		},
		setShadows(on) {
			look.setShadows(on);
		},
		dispose() {
			look.dispose();
		}
	};
}
