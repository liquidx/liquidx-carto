/**
 * Streaming terrain for the snowboard game, from the same XYZ tile providers (and cache) as
 * the contour and diorama tools.
 *
 * The play area is a rectangle of z16 tiles. Every cell gets a coarse mesh from its z16 tile
 * (GSI DEM1A at ~1.8 m a pixel, where surveyed), and the cells round the rider get a fine mesh
 * from the four z17 tiles beneath them (~0.9 m a pixel), fetched as the rider moves. Physics
 * samples whichever level a cell is showing, so the board stays on the visible surface.
 */
import * as THREE from 'three';
import {
	bilinear,
	loadTile,
	tileRange,
	type Tile,
	type TerrainProvider
} from '$lib/contour/terrain-api';
import type { LocalFrame } from './frame';

export const BASE_ZOOM = 16;
export const FINE_ZOOM = 17;
/** Vertices along a side of a coarse chunk (~7 m apart) and a fine one (~1.8 m apart). */
const BASE_SEGMENTS = 64;
const FINE_SEGMENTS = 256;
/** Cells this far (in cells, Chebyshev) from the rider's cell are shown fine... */
const FINE_RADIUS = 1;
/** ...and fine meshes this far away are dropped. */
const DROP_RADIUS = 2;
/** How far chunk edges hang down, to hide seams between levels of detail. */
const SKIRT = 8;

interface Cell {
	tx: number;
	ty: number;
	base: Tile | null;
	/** The z17 tiles under this cell, nw, ne, sw, se, once all four have been requested. */
	fine: (Tile | null)[] | null;
	loadingFine: boolean;
	baseMesh: THREE.Mesh | null;
	fineMesh: THREE.Mesh | null;
	/** True once the fine mesh is showing, and physics should read the fine tiles. */
	fineActive: boolean;
}

export interface TerrainProgress {
	loaded: number;
	total: number;
}

export class Terrain {
	readonly group = new THREE.Group();
	readonly material: THREE.MeshStandardMaterial;
	private readonly cells = new Map<string, Cell>();
	private readonly range;
	private readonly buildQueue: Cell[] = [];
	/** The cell the rider was in at the last update, to skip LOD work while they stay put. */
	private lastCell = '';
	private disposed = false;

	constructor(
		readonly frame: LocalFrame,
		readonly provider: TerrainProvider,
		map: THREE.Texture
	) {
		this.range = tileRange(frame.box, BASE_ZOOM);
		// Double-sided so the skirts show whichever way they are wound.
		this.material = new THREE.MeshStandardMaterial({
			map,
			roughness: 0.92,
			metalness: 0,
			side: THREE.DoubleSide
		});
		for (let ty = this.range.ty0; ty <= this.range.ty1; ty++)
			for (let tx = this.range.tx0; tx <= this.range.tx1; tx++)
				this.cells.set(`${tx},${ty}`, {
					tx,
					ty,
					base: null,
					fine: null,
					loadingFine: false,
					baseMesh: null,
					fineMesh: null,
					fineActive: false
				});
	}

	get cellCount() {
		return this.cells.size;
	}

	/** Fetch every base tile and build the coarse meshes. */
	async loadBase(onProgress?: (p: TerrainProgress) => void) {
		const cells = [...this.cells.values()];
		let loaded = 0;
		onProgress?.({ loaded, total: cells.length });
		await Promise.all(
			cells.map(async (cell) => {
				cell.base = await loadTile(this.provider, BASE_ZOOM, cell.tx, cell.ty);
				loaded++;
				onProgress?.({ loaded, total: cells.length });
			})
		);
		if (this.disposed) return;
		for (const cell of cells) {
			cell.baseMesh = this.buildMesh(cell, BASE_ZOOM, BASE_SEGMENTS);
			this.group.add(cell.baseMesh);
		}
	}

	/** Mercator x and y as z16 tile indices, and the cell there if any. */
	private cellAt(mx: number, my: number): Cell | undefined {
		const n = 2 ** BASE_ZOOM;
		return this.cells.get(`${Math.floor(mx * n)},${Math.floor(my * n)}`);
	}

	/** Elevation at mercator (mx, my) from the tiles of one zoom, or NaN with no data there. */
	private sampleZoom(mx: number, my: number, zoom: number): number {
		const n = 2 ** zoom;
		const tx = Math.floor(mx * n);
		const ty = Math.floor(my * n);
		const cell = this.cellAt(mx, my);
		if (!cell) return NaN;
		let tile: Tile | null = null;
		if (zoom === BASE_ZOOM) tile = cell.base;
		else if (cell.fine) tile = cell.fine[(tx & 1) + (ty & 1) * 2];
		if (!tile) return NaN;
		const s = tile.size;
		return bilinear(tile.data, s, s, (mx * n - tx) * s - 0.5, (my * n - ty) * s - 0.5);
	}

	/** Elevation in metres at world x, z, from whichever level of detail is showing there. */
	height(x: number, z: number): number {
		const [mx, my] = this.frame.worldToMercator(x, z);
		const cell = this.cellAt(mx, my);
		if (!cell) return 0;
		let h = cell.fineActive ? this.sampleZoom(mx, my, FINE_ZOOM) : NaN;
		if (Number.isNaN(h)) h = this.sampleZoom(mx, my, BASE_ZOOM);
		return Number.isNaN(h) ? 0 : h;
	}

	/** Surface normal at world x, z, by central differences. */
	normal(x: number, z: number, target = new THREE.Vector3(), d = 1.5): THREE.Vector3 {
		const dx = this.height(x + d, z) - this.height(x - d, z);
		const dz = this.height(x, z + d) - this.height(x, z - d);
		return target.set(-dx, 2 * d, -dz).normalize();
	}

	/** True when world x, z is inside the play area. */
	contains(x: number, z: number) {
		const [mx, my] = this.frame.worldToMercator(x, z);
		return this.cellAt(mx, my) !== undefined;
	}

	/**
	 * Keep the fine level of detail round the rider. Call every frame: fetches are kicked off
	 * when the rider changes cell, and at most one mesh is built per call to avoid a stutter.
	 */
	update(riderX: number, riderZ: number) {
		const [mx, my] = this.frame.worldToMercator(riderX, riderZ);
		const n = 2 ** BASE_ZOOM;
		const cx = Math.floor(mx * n);
		const cy = Math.floor(my * n);
		const key = `${cx},${cy}`;
		if (key !== this.lastCell) {
			this.lastCell = key;
			for (const cell of this.cells.values()) {
				const far = Math.max(Math.abs(cell.tx - cx), Math.abs(cell.ty - cy));
				if (far <= FINE_RADIUS) this.requestFine(cell);
				else if (far > DROP_RADIUS && (cell.fineMesh || cell.fine)) this.dropFine(cell);
			}
			// Nearest first, so the ground under the rider sharpens before the surroundings.
			this.buildQueue.sort(
				(a, b) => Math.hypot(a.tx - cx, a.ty - cy) - Math.hypot(b.tx - cx, b.ty - cy)
			);
		}
		const next = this.buildQueue.shift();
		if (next && next.fine && !next.fineMesh) {
			next.fineMesh = this.buildMesh(next, FINE_ZOOM, FINE_SEGMENTS);
			this.group.add(next.fineMesh);
			next.fineActive = true;
			if (next.baseMesh) next.baseMesh.visible = false;
		}
	}

	private requestFine(cell: Cell) {
		if (cell.fine || cell.loadingFine || !cell.base) return;
		cell.loadingFine = true;
		const x = cell.tx * 2;
		const y = cell.ty * 2;
		Promise.all([
			loadTile(this.provider, FINE_ZOOM, x, y),
			loadTile(this.provider, FINE_ZOOM, x + 1, y),
			loadTile(this.provider, FINE_ZOOM, x, y + 1),
			loadTile(this.provider, FINE_ZOOM, x + 1, y + 1)
		])
			.then((tiles) => {
				// Dropped again, or torn down, while the tiles were on their way.
				if (this.disposed || !cell.loadingFine) return;
				cell.fine = tiles;
				this.buildQueue.push(cell);
			})
			.catch(() => {})
			.finally(() => (cell.loadingFine = false));
	}

	private dropFine(cell: Cell) {
		cell.loadingFine = false;
		cell.fine = null;
		cell.fineActive = false;
		const i = this.buildQueue.indexOf(cell);
		if (i >= 0) this.buildQueue.splice(i, 1);
		if (cell.fineMesh) {
			this.group.remove(cell.fineMesh);
			cell.fineMesh.geometry.dispose();
			cell.fineMesh = null;
		}
		if (cell.baseMesh) cell.baseMesh.visible = true;
	}

	/**
	 * A chunk for one cell: a regular grid of `segments` × `segments` quads over the cell with
	 * smooth normals, plus a skirt hanging from each edge. Heights come from `zoom`, falling
	 * back to the base tiles where fine data is missing.
	 */
	private buildMesh(cell: Cell, zoom: number, segments: number): THREE.Mesh {
		const n = 2 ** BASE_ZOOM;
		const mx0 = cell.tx / n;
		const my0 = cell.ty / n;
		const step = 1 / n / segments;
		const N = segments + 1;
		const { frame } = this;

		// Heights on the grid with a one-sample border for the normals.
		const H = new Float32Array((N + 2) * (N + 2));
		const sample = (mx: number, my: number) => {
			let h = zoom === FINE_ZOOM ? this.sampleZoom(mx, my, FINE_ZOOM) : NaN;
			if (Number.isNaN(h)) h = this.sampleZoom(mx, my, BASE_ZOOM);
			return Number.isNaN(h) ? 0 : h;
		};
		for (let j = -1; j <= N; j++) {
			// Rows past the cell read the neighbouring cell's tiles; clamp at the area's edge.
			const my = Math.min(frame.box.y1, Math.max(frame.box.y0, my0 + j * step));
			for (let i = -1; i <= N; i++) {
				const mx = Math.min(frame.box.x1, Math.max(frame.box.x0, mx0 + i * step));
				H[(j + 1) * (N + 2) + i + 1] = sample(mx, my);
			}
		}

		const count = N * N + 4 * N;
		const positions = new Float32Array(count * 3);
		const normals = new Float32Array(count * 3);
		const uvs = new Float32Array(count * 2);
		const [X0, Z0] = frame.mercatorToWorld(frame.box.x0, frame.box.y0);
		const spacing = step * frame.scale;
		const at = (i: number, j: number) => H[(j + 1) * (N + 2) + i + 1];
		const nrm = new THREE.Vector3();
		let v = 0;
		const put = (i: number, j: number, drop: number) => {
			const [x, z] = frame.mercatorToWorld(mx0 + i * step, my0 + j * step);
			positions[v * 3] = x;
			positions[v * 3 + 1] = at(i, j) - drop;
			positions[v * 3 + 2] = z;
			nrm.set(at(i - 1, j) - at(i + 1, j), 2 * spacing, at(i, j - 1) - at(i, j + 1)).normalize();
			normals[v * 3] = nrm.x;
			normals[v * 3 + 1] = nrm.y;
			normals[v * 3 + 2] = nrm.z;
			uvs[v * 2] = (x - X0) / frame.width;
			uvs[v * 2 + 1] = 1 - (z - Z0) / frame.height;
			return v++;
		};
		for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) put(i, j, 0);

		const index = new Uint32Array(segments * segments * 6 + 4 * segments * 6);
		let k = 0;
		const quad = (a: number, b: number, c: number, d: number) => {
			// a—b along one row, c—d along the next, wound to face up.
			index[k++] = a;
			index[k++] = c;
			index[k++] = b;
			index[k++] = b;
			index[k++] = c;
			index[k++] = d;
		};
		for (let j = 0; j < segments; j++)
			for (let i = 0; i < segments; i++) {
				const a = j * N + i;
				quad(a, a + 1, a + N, a + N + 1);
			}
		// Skirts: a copy of each edge lowered by SKIRT, joined to it.
		const edge = (list: [number, number][]) => {
			const low = list.map(([i, j]) => put(i, j, SKIRT));
			for (let t = 0; t < list.length - 1; t++) {
				const [i0, j0] = list[t];
				const [i1, j1] = list[t + 1];
				quad(j0 * N + i0, j1 * N + i1, low[t], low[t + 1]);
			}
		};
		const row = (j: number) => Array.from({ length: N }, (_, i) => [i, j] as [number, number]);
		const col = (i: number) => Array.from({ length: N }, (_, j) => [i, j] as [number, number]);
		edge(row(0));
		edge(row(segments));
		edge(col(0));
		edge(col(segments));

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
		geometry.setIndex(new THREE.BufferAttribute(index, 1));
		geometry.computeBoundingSphere();
		const mesh = new THREE.Mesh(geometry, this.material);
		mesh.receiveShadow = true;
		mesh.matrixAutoUpdate = false;
		return mesh;
	}

	dispose() {
		this.disposed = true;
		for (const cell of this.cells.values()) {
			cell.baseMesh?.geometry.dispose();
			cell.fineMesh?.geometry.dispose();
		}
		this.group.clear();
		this.material.dispose();
	}
}
