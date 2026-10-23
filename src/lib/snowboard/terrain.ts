/**
 * Streaming terrain for the snowboard game, from the same XYZ tile providers (and cache) as
 * the contour and diorama tools.
 *
 * The play area is a rectangle of z16 tiles. Every cell gets a coarse mesh from its z16 tile
 * (GSI DEM1A at ~1.8 m a pixel, where surveyed), and the cells round the rider get a fine one
 * from the four z17 tiles beneath them (~0.9 m a pixel), fetched as the rider moves. Physics
 * samples whichever level a cell is showing, so the board stays on the visible surface.
 *
 * A fine chunk is not built on the CPU at all: every one shares a flat grid, lifted in the
 * vertex shader from a texture of its four z17 tiles' heights. The snow is shaded by `snow.ts`.
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
import type { SnowShader } from './snow';

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
/** Base tiles fetched at once. */
const LOAD_CONCURRENCY = 12;

/** Once a buffer is on the GPU its CPU copy is dead weight: nothing here reads it back. */
function freeAfterUpload(this: THREE.BufferAttribute) {
	// @ts-expect-error three allows this: the attribute keeps its count and item size.
	this.array = null;
}

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
	/** The fine mesh's heights. */
	fineHeight: THREE.DataTexture | null;
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
	/** The fine chunks' shared grid, and the per-chunk geometries over it not in use. */
	private grid: THREE.BufferGeometry | null = null;
	private readonly spareGeometries: THREE.BufferGeometry[] = [];
	/** Holds the fine chunks' shader, compiled ahead and never let go, see `compile`. */
	private warm: { mesh: THREE.Mesh; height: THREE.DataTexture } | null = null;

	constructor(
		readonly frame: LocalFrame,
		readonly provider: TerrainProvider,
		private readonly snow: SnowShader
	) {
		this.range = tileRange(frame.box, BASE_ZOOM);
		this.material = this.makeMaterial();
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
					fineActive: false,
					fineHeight: null
				});
	}

	get cellCount() {
		return this.cells.size;
	}

	/**
	 * Fetch every base tile and build the coarse meshes. A few tiles at a time: each one in
	 * flight holds a bitmap, its pixels and the decoded heights, and two hundred at once is a
	 * spike a phone cannot take.
	 */
	async loadBase(onProgress?: (p: TerrainProgress) => void) {
		const cells = [...this.cells.values()];
		let loaded = 0;
		let next = 0;
		onProgress?.({ loaded, total: cells.length });
		const worker = async () => {
			while (next < cells.length && !this.disposed) {
				const cell = cells[next++];
				cell.base = await loadTile(this.provider, BASE_ZOOM, cell.tx, cell.ty);
				loaded++;
				onProgress?.({ loaded, total: cells.length });
			}
		};
		await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
		if (this.disposed) return;
		for (const cell of cells) {
			cell.baseMesh = this.buildMesh(cell);
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
			next.fineMesh = this.buildFineMesh(next);
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
			// The geometry only points at the shared grid: disposing it would free the grid's buffers.
			this.spareGeometries.push(cell.fineMesh.geometry);
			(cell.fineMesh.material as THREE.Material).dispose();
			cell.fineMesh = null;
		}
		cell.fineHeight?.dispose();
		cell.fineHeight = null;
		if (cell.baseMesh) cell.baseMesh.visible = true;
	}

	/**
	 * A coarse chunk for one cell: a regular grid of quads over the cell from its base tile, with
	 * smooth normals, plus a skirt hanging from each edge.
	 */
	private buildMesh(cell: Cell): THREE.Mesh {
		const segments = BASE_SEGMENTS;
		const n = 2 ** BASE_ZOOM;
		const mx0 = cell.tx / n;
		const my0 = cell.ty / n;
		const step = 1 / n / segments;
		const N = segments + 1;
		const { frame } = this;

		// Heights on the grid with a one-sample border for the normals.
		const H = new Float32Array((N + 2) * (N + 2));
		const sample = (mx: number, my: number) => {
			const h = this.sampleZoom(mx, my, BASE_ZOOM);
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
			return v++;
		};
		for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) put(i, j, 0);

		const indices = segments * segments * 6 + 4 * segments * 6;
		const index = new Uint16Array(indices);
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
		geometry.setIndex(new THREE.BufferAttribute(index, 1));
		// Culling needs the sphere, so work it out while the positions are still here.
		geometry.computeBoundingSphere();
		for (const attribute of [...Object.values(geometry.attributes), geometry.index!])
			(attribute as THREE.BufferAttribute).onUpload(freeAfterUpload);
		const mesh = new THREE.Mesh(geometry, this.material);
		mesh.receiveShadow = true;
		mesh.matrixAutoUpdate = false;
		return mesh;
	}

	/**
	 * Compile the fine chunks' shader now, while loading, rather than mid-run when the first one
	 * shows. The stand-in keeps it: three drops a program once no material uses it.
	 */
	compile(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene) {
		if (this.warm) return;
		const height = new THREE.DataTexture(
			new Float32Array(1),
			1,
			1,
			THREE.RedFormat,
			THREE.FloatType
		);
		height.needsUpdate = true;
		const geometry = new THREE.BufferGeometry();
		const position = new THREE.Float32BufferAttribute([0, 0, 0], 3);
		geometry.setAttribute('position', position);
		geometry.setAttribute('normal', position);
		const mesh = new THREE.Mesh(geometry, this.makeMaterial(height, 1));
		mesh.receiveShadow = true;
		this.warm = { mesh, height };
		renderer.compile(new THREE.Scene().add(mesh), camera, scene);
	}

	/**
	 * Double-sided so the skirts show whichever way they are wound. With `height`, a material for
	 * one fine chunk.
	 */
	private makeMaterial(height?: THREE.DataTexture, texels = 0): THREE.MeshStandardMaterial {
		const { snow } = this;
		const material = new THREE.MeshStandardMaterial({
			roughness: 0.92,
			metalness: 0,
			side: THREE.DoubleSide
		});
		const lift = height && {
			terrainHeight: { value: height },
			terrainTexels: { value: texels },
			terrainSpacing: { value: this.frame.scale / 2 ** BASE_ZOOM / FINE_SEGMENTS }
		};
		material.onBeforeCompile = (shader) => {
			snow.patch(shader);
			if (lift) liftOnGpu(shader, lift);
		};
		material.customProgramCacheKey = () => `${snow.key},${height ? 'fine' : ''}`;
		return material;
	}

	/**
	 * A fine chunk: the four z17 tiles side by side in one float texture, with holes filled from
	 * the base tile, over the shared grid.
	 */
	private buildFineMesh(cell: Cell): THREE.Mesh {
		const tiles = cell.fine!;
		const s = tiles.find((t) => t)?.size ?? 256;
		const S = s * 2;
		const data = new Float32Array(S * S);
		const n = 2 ** FINE_ZOOM;
		let lo = Infinity;
		let hi = -Infinity;
		for (let q = 0; q < 4; q++) {
			const tile = tiles[q];
			const ox = (q & 1) * s;
			const oy = (q >> 1) * s;
			for (let y = 0; y < s; y++)
				for (let x = 0; x < s; x++) {
					let h = tile ? tile.data[y * s + x] : NaN;
					if (Number.isNaN(h)) {
						h = this.sampleZoom(
							(cell.tx * 2 + (ox + x + 0.5) / s) / n,
							(cell.ty * 2 + (oy + y + 0.5) / s) / n,
							BASE_ZOOM
						);
						if (Number.isNaN(h)) h = 0;
					}
					data[(oy + y) * S + ox + x] = h;
					if (h < lo) lo = h;
					if (h > hi) hi = h;
				}
		}
		const height = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.FloatType);
		height.needsUpdate = true;
		// As with the meshes: once on the GPU the CPU copy is dead weight.
		height.onUpdate = () => ((height.image as { data: unknown }).data = null);
		cell.fineHeight = height;

		this.grid ??= fineGrid();
		const geometry = this.spareGeometries.pop() ?? new THREE.BufferGeometry();
		for (const name of ['position', 'normal'])
			geometry.setAttribute(name, this.grid.getAttribute(name));
		geometry.setIndex(this.grid.index);
		const size = this.frame.scale / 2 ** BASE_ZOOM;
		geometry.boundingSphere = new THREE.Sphere(
			new THREE.Vector3(size / 2, (lo + hi) / 2, size / 2),
			Math.hypot(size / 2, size / 2, (hi - lo) / 2 + SKIRT)
		);
		const mesh = new THREE.Mesh(geometry, this.makeMaterial(height, S / FINE_SEGMENTS));
		const [x, z] = this.frame.mercatorToWorld(cell.tx / 2 ** BASE_ZOOM, cell.ty / 2 ** BASE_ZOOM);
		mesh.position.set(x, 0, z);
		mesh.updateMatrix();
		mesh.matrixAutoUpdate = false;
		mesh.receiveShadow = true;
		return mesh;
	}

	dispose() {
		this.disposed = true;
		for (const cell of this.cells.values()) {
			cell.baseMesh?.geometry.dispose();
			(cell.fineMesh?.material as THREE.Material | undefined)?.dispose();
			cell.fineHeight?.dispose();
		}
		this.grid?.dispose();
		if (this.warm) {
			(this.warm.mesh.material as THREE.Material).dispose();
			this.warm.mesh.geometry.dispose();
			this.warm.height.dispose();
		}
		this.group.clear();
		this.material.dispose();
	}
}

/**
 * The grid shared by every fine chunk: vertex x and z are grid steps, y is 1 on the
 * skirts, and the vertex shader puts them in place.
 */
function fineGrid(): THREE.BufferGeometry {
	const N = FINE_SEGMENTS + 1;
	const positions: number[] = [];
	for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) positions.push(i, 0, j);
	const index: number[] = [];
	const quad = (a: number, b: number, c: number, d: number) => index.push(a, c, b, b, c, d);
	for (let j = 0; j < FINE_SEGMENTS; j++)
		for (let i = 0; i < FINE_SEGMENTS; i++) {
			const a = j * N + i;
			quad(a, a + 1, a + N, a + N + 1);
		}
	const edge = (list: [number, number][]) => {
		const first = positions.length / 3;
		for (const [i, j] of list) positions.push(i, 1, j);
		for (let t = 0; t < list.length - 1; t++) {
			const [i0, j0] = list[t];
			const [i1, j1] = list[t + 1];
			quad(j0 * N + i0, j1 * N + i1, first + t, first + t + 1);
		}
	};
	const row = (j: number) => Array.from({ length: N }, (_, i) => [i, j] as [number, number]);
	const col = (i: number) => Array.from({ length: N }, (_, j) => [i, j] as [number, number]);
	edge(row(0));
	edge(row(FINE_SEGMENTS));
	edge(col(0));
	edge(col(FINE_SEGMENTS));
	const geometry = new THREE.BufferGeometry();
	const position = new THREE.Float32BufferAttribute(positions, 3);
	geometry.setAttribute('position', position);
	// Without a normal three shades flat. The shader makes its own, so the positions stand in:
	// the same buffer, uploaded once.
	geometry.setAttribute('normal', position);
	geometry.setIndex(index);
	return geometry;
}

/**
 * Lift the shared grid into place: heights bilinear from the texture (fetched by hand, as float
 * textures need not be filterable), normals by central differences as `buildMesh` makes them.
 */
function liftOnGpu(
	shader: THREE.WebGLProgramParametersWithUniforms,
	uniforms: Record<string, THREE.IUniform>
) {
	Object.assign(shader.uniforms, uniforms);
	shader.vertexShader = shader.vertexShader
		.replace(
			'#include <common>',
			/* glsl */ `#include <common>
			uniform sampler2D terrainHeight;
			uniform float terrainTexels;
			uniform float terrainSpacing;
			float terrainH(vec2 ij) {
				vec2 p = ij * terrainTexels - 0.5;
				vec2 i0 = floor(p);
				vec2 t = p - i0;
				ivec2 top = textureSize(terrainHeight, 0) - 1;
				ivec2 a = clamp(ivec2(i0), ivec2(0), top);
				ivec2 b = clamp(ivec2(i0) + 1, ivec2(0), top);
				return mix(
					mix(texelFetch(terrainHeight, a, 0).r, texelFetch(terrainHeight, ivec2(b.x, a.y), 0).r, t.x),
					mix(texelFetch(terrainHeight, ivec2(a.x, b.y), 0).r, texelFetch(terrainHeight, b, 0).r, t.x),
					t.y
				);
			}`
		)
		.replace(
			'#include <uv_vertex>',
			/* glsl */ `
			vec2 terrainIJ = position.xz;
			vec3 terrainLocal = vec3(
				terrainIJ.x * terrainSpacing,
				terrainH(terrainIJ) - position.y * ${SKIRT.toFixed(1)},
				terrainIJ.y * terrainSpacing
			);
			#include <uv_vertex>`
		)
		.replace(
			'#include <beginnormal_vertex>',
			/* glsl */ `
			float terrainDx = terrainH(terrainIJ + vec2(1.0, 0.0)) - terrainH(terrainIJ - vec2(1.0, 0.0));
			float terrainDz = terrainH(terrainIJ + vec2(0.0, 1.0)) - terrainH(terrainIJ - vec2(0.0, 1.0));
			vec3 objectNormal = normalize(vec3(-terrainDx, 2.0 * terrainSpacing, -terrainDz));`
		)
		.replace('#include <begin_vertex>', 'vec3 transformed = terrainLocal;');
}
