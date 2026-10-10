/**
 * Forest: low-poly firs scattered everywhere the ground mask allows, with a grid for collision
 * lookups. Every tree of the resort is planted, but in square chunks of instanced meshes, so
 * the ones out of view are culled and the far ones are drawn as a single cone without a trunk.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Ground } from './ground';
import type { LocalFrame } from './frame';
import type { Terrain } from './terrain';

/**
 * Where there is no woods data to say, trees thin out from here and stop at the top of the
 * band: a guess at the treeline, in metres.
 */
const TREELINE = [1180, 1300];
/** The side of a chunk of forest, in metres. */
const CHUNK = 256;
/** Chunks nearer than this have trunks, and their trees all three tiers of branches. */
const TRUNK_RANGE = 450;
const DETAIL_RANGE = 900;
/** Chunks past this are not drawn: the fog has taken them. */
const RANGE = 5600;
/** Collision grid cell in metres. */
const GRID = 24;

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
	// The same tree from far off: one cone the shape of the three.
	const distant = new THREE.ConeGeometry(1.9, 8.6, 5, 1, true).translate(0, 1.6 + 4.3, 0);

	// Trees by chunk.
	const chunkCols = Math.ceil(frame.width / CHUNK);
	const members = new Map<number, number[]>();
	for (let i = 0; i < count; i++) {
		const k =
			Math.floor((spots[i * 5 + 2] + frame.height / 2) / CHUNK) * chunkCols +
			Math.floor((spots[i * 5] + frame.width / 2) / CHUNK);
		const list = members.get(k);
		if (list) list.push(i);
		else members.set(k, [i]);
	}

	const group = new THREE.Group();
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const turn = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const dark = new THREE.Color('#2f5a3a');
	const snowy = new THREE.Color('#9fb7a6');
	const tint = new THREE.Color();
	const chunks: {
		centre: THREE.Vector3;
		radius: number;
		trunks: THREE.InstancedMesh;
		crowns: THREE.InstancedMesh;
		far: THREE.InstancedMesh;
	}[] = [];
	for (const list of members.values()) {
		const trunks = new THREE.InstancedMesh(trunk, trunkMaterial, list.length);
		const crowns = new THREE.InstancedMesh(foliage, foliageMaterial, list.length);
		list.forEach((i, n) => {
			const [x, y, z, s, r] = spots.slice(i * 5, i * 5 + 5);
			position.set(x, y - 0.5, z);
			turn.setFromAxisAngle(up, r * Math.PI * 2);
			scale.set(s * (0.85 + r * 0.3), s, s * (0.85 + r * 0.3));
			matrix.compose(position, turn, scale);
			crowns.setMatrixAt(n, matrix);
			crowns.setColorAt(n, tint.copy(dark).lerp(snowy, r * 0.55));
		});
		// One set of places and tints for all three meshes.
		trunks.instanceMatrix = crowns.instanceMatrix;
		const far = new THREE.InstancedMesh(distant, foliageMaterial, list.length);
		far.instanceMatrix = crowns.instanceMatrix;
		far.instanceColor = crowns.instanceColor;
		// The sphere round the whole chunk is what lets the renderer skip it when out of view.
		crowns.computeBoundingSphere();
		const sphere = crowns.boundingSphere!;
		trunks.boundingSphere = far.boundingSphere = sphere;
		for (const mesh of [trunks, crowns, far]) mesh.matrixAutoUpdate = false;
		group.add(trunks, crowns, far);
		chunks.push({ centre: sphere.center, radius: sphere.radius, trunks, crowns, far });
	}

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
		update(eye) {
			for (const chunk of chunks) {
				const d = chunk.centre.distanceTo(eye) - chunk.radius;
				chunk.trunks.visible = d < TRUNK_RANGE;
				chunk.crowns.visible = d < DETAIL_RANGE;
				chunk.far.visible = d >= DETAIL_RANGE && d < RANGE;
			}
		},
		setShadows(on) {
			// Only the detailed trees are ever near enough to throw a shadow that is seen.
			for (const chunk of chunks) chunk.trunks.castShadow = chunk.crowns.castShadow = on;
		},
		dispose() {
			trunk.dispose();
			foliage.dispose();
			distant.dispose();
			trunkMaterial.dispose();
			foliageMaterial.dispose();
			for (const chunk of chunks) {
				chunk.trunks.dispose();
				chunk.crowns.dispose();
				chunk.far.dispose();
			}
		}
	};
}
