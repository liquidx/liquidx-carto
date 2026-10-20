/**
 * Buildings from Re:Earth Buildings: Overture Maps footprints extruded to 3D Tiles, served as
 * one GLB per web-mercator tile. Big footprints live at zoom 12, medium at 13 and the rest at
 * 14, so all three zooms are needed to see every building in an area.
 *
 * Each GLB holds east/north/up metres about an anchor near the tile's centre. This module turns
 * them into longitude, latitude and height above each building's own base, so a consumer can
 * stand them on whatever terrain it uses, and tests whether they stand in the way of a view.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { latToY, lonToX } from '$lib/contour/mercator';
import { EARTH_RADIUS, REFRACTION_K, type LngLat } from './geo';
import type { Elevation } from './alignment';

export const BUILDINGS_URL = 'https://buildings.reearth.land';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** WGS84, as the tiles' own tangent-plane maths uses it. */
const WGS84_A = 6_378_137;
const WGS84_E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);

export interface BuildingFeature {
	/** Centroid of the footprint. */
	lon: number;
	lat: number;
	/** Metres from the centroid to the farthest vertex. */
	radius: number;
	/** Height of the top above the base, metres. */
	height: number;
	/** The triangles of this building: indices into `index`, three per triangle. */
	triangles: Uint32Array;
}

export interface BuildingTile {
	z: number;
	x: number;
	y: number;
	lon: Float64Array;
	lat: Float64Array;
	/** Height of each vertex above its building's base, metres. */
	rel: Float32Array;
	index: Uint32Array;
	/** Which building each vertex belongs to. */
	feature: Uint32Array;
	features: BuildingFeature[];
}

// ── tiles ───────────────────────────────────────────

export interface TileId {
	z: number;
	x: number;
	y: number;
}

export const tileKey = (t: TileId) => `${t.z}/${t.x}/${t.y}`;

export function tileAt(lon: number, lat: number, z: number): TileId {
	const n = 2 ** z;
	return {
		z,
		x: Math.min(n - 1, Math.max(0, Math.floor(lonToX(lon) * n))),
		y: Math.min(n - 1, Math.max(0, Math.floor(latToY(lat) * n)))
	};
}

/** Degrees of longitude and latitude per metre near a latitude. */
function perMetre(lat: number) {
	const k = RAD * EARTH_RADIUS;
	return { lon: 1 / (k * Math.cos(lat * RAD)), lat: 1 / k };
}

/** Every tile at a zoom within `radius` metres of a point (as a box). */
export function tilesAround(centre: LngLat, z: number, radius: number): TileId[] {
	const d = perMetre(centre.lat);
	const a = tileAt(centre.lon - radius * d.lon, centre.lat + radius * d.lat, z);
	const b = tileAt(centre.lon + radius * d.lon, centre.lat - radius * d.lat, z);
	const out: TileId[] = [];
	for (let y = a.y; y <= b.y; y++) for (let x = a.x; x <= b.x; x++) out.push({ z, x, y });
	return out;
}

/**
 * The tiles a corridor passes through: from `origin` along `bearing` for `length` metres, and
 * `halfWidth` metres to either side.
 */
export function tilesAlong(
	origin: LngLat,
	bearing: number,
	length: number,
	halfWidth: number,
	z: number
): TileId[] {
	const d = perMetre(origin.lat);
	const b = bearing * RAD;
	const seen = new Map<string, TileId>();
	const step = Math.min(300, length / 4);
	for (let s = 0; s <= length; s += step) {
		for (const w of [-halfWidth, 0, halfWidth]) {
			const east = s * Math.sin(b) + w * Math.cos(b);
			const north = s * Math.cos(b) - w * Math.sin(b);
			const t = tileAt(origin.lon + east * d.lon, origin.lat + north * d.lat, z);
			seen.set(tileKey(t), t);
		}
	}
	return [...seen.values()];
}

// ── decoding ────────────────────────────────────────

/** Geodetic coordinates of an ECEF point (Bowring), as the tiles anchor themselves. */
function ecefToLngLat(x: number, y: number, z: number): LngLat & { height: number } {
	const lon = Math.atan2(y, x);
	const p = Math.hypot(x, y);
	const b = WGS84_A * Math.sqrt(1 - WGS84_E2);
	const ep2 = (WGS84_A * WGS84_A - b * b) / (b * b);
	const th = Math.atan2(z * WGS84_A, p * b);
	const lat = Math.atan2(
		z + ep2 * b * Math.sin(th) ** 3,
		p - WGS84_E2 * WGS84_A * Math.cos(th) ** 3
	);
	const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
	return { lon: lon * DEG, lat: lat * DEG, height: p / Math.cos(lat) - N };
}

/** Web-mercator bounds of a tile in degrees. */
export function tileBounds(t: TileId) {
	const n = 2 ** t.z;
	const lat = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * DEG;
	return {
		west: (t.x / n) * 360 - 180,
		east: ((t.x + 1) / n) * 360 - 180,
		north: lat(t.y),
		south: lat(t.y + 1)
	};
}

export interface RawTile {
	/** Metres about the anchor in the GLB's own frame, three per vertex; `matrix` takes them to ECEF. */
	positions: Float32Array;
	index: Uint32Array;
	/** One per vertex. */
	featureIds: ArrayLike<number>;
	/** The root node's column-major matrix, ENU → ECEF, as the GLB carries it. */
	matrix: ArrayLike<number>;
}

/**
 * The anchor the GLB's vertices are about, and how its axes lie. A 3D Tiles GLB may carry its
 * matrix in the y-up frame the format asks for (ECEF = (x, −z, y) of what it holds), so both
 * readings of the translation are tried and the one inside the tile wins.
 */
function frameOf(matrix: ArrayLike<number>, tile: TileId) {
	const b = tileBounds(tile);
	const inside = (p: LngLat) =>
		p.lon >= b.west - 0.01 &&
		p.lon <= b.east + 0.01 &&
		p.lat >= b.south - 0.01 &&
		p.lat <= b.north + 0.01;
	const asIs = (x: number, y: number, z: number) => [x, y, z];
	const yUp = (x: number, y: number, z: number) => [x, -z, y];
	const readings = [asIs, yUp].map((toEcef) => ({
		toEcef,
		anchor: ecefToLngLat(
			...(toEcef(matrix[12], matrix[13], matrix[14]) as [number, number, number])
		)
	}));
	return readings.find((r) => inside(r.anchor)) ?? readings[0];
}

export function anchorOf(matrix: ArrayLike<number>, tile: TileId): LngLat {
	return frameOf(matrix, tile).anchor;
}

/** Decode a tile's arrays into buildings on the globe. */
export function decodeTile(raw: RawTile, tile: TileId): BuildingTile {
	const { anchor, toEcef } = frameOf(raw.matrix, tile);
	const m = raw.matrix;
	// The matrix's axes in ECEF, then in east / north / up at the anchor, so a vertex's local
	// offsets can be read straight off whichever way up the tile was written.
	const axes = [0, 4, 8].map((c) => toEcef(m[c], m[c + 1], m[c + 2]));
	const lo = anchor.lon * RAD,
		la = anchor.lat * RAD;
	const E = [-Math.sin(lo), Math.cos(lo), 0];
	const N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
	const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
	const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const toEnu = [E, N, U].map((dir) => axes.map((a) => dot(a, dir)));
	const n = raw.positions.length / 3;
	const lon = new Float64Array(n);
	const lat = new Float64Array(n);
	const rel = new Float32Array(n);
	const feature = new Uint32Array(n);
	const cosLat = Math.cos(anchor.lat * RAD);
	// Each building's base is its lowest vertex.
	const base = new Map<number, number>();
	for (let i = 0; i < n; i++) {
		const px = raw.positions[3 * i],
			py = raw.positions[3 * i + 1],
			pz = raw.positions[3 * i + 2];
		const e = toEnu[0][0] * px + toEnu[0][1] * py + toEnu[0][2] * pz;
		const no = toEnu[1][0] * px + toEnu[1][1] * py + toEnu[1][2] * pz;
		const up = toEnu[2][0] * px + toEnu[2][1] * py + toEnu[2][2] * pz;
		lon[i] = anchor.lon + (e / (WGS84_A * cosLat)) * DEG;
		lat[i] = anchor.lat + (no / WGS84_A) * DEG;
		rel[i] = up;
		const f = raw.featureIds[i];
		feature[i] = f;
		const b = base.get(f);
		if (b === undefined || up < b) base.set(f, up);
	}
	const ids = [...base.keys()].sort((a, b) => a - b);
	const slot = new Map(ids.map((id, i) => [id, i]));
	const sums = ids.map(() => ({ lon: 0, lat: 0, count: 0, height: 0, tris: [] as number[] }));
	for (let i = 0; i < n; i++) {
		const s = sums[slot.get(feature[i])!];
		rel[i] -= base.get(feature[i])!;
		feature[i] = slot.get(feature[i])!;
		s.lon += lon[i];
		s.lat += lat[i];
		s.count++;
		if (rel[i] > s.height) s.height = rel[i];
	}
	for (let t = 0; t < raw.index.length; t += 3) sums[feature[raw.index[t]]].tris.push(t);
	const features: BuildingFeature[] = sums.map((s) => ({
		lon: s.lon / s.count,
		lat: s.lat / s.count,
		radius: 0,
		height: s.height,
		triangles: Uint32Array.from(s.tris)
	}));
	for (let i = 0; i < n; i++) {
		const f = features[feature[i]];
		const d = perMetre(f.lat);
		const r = Math.hypot((lon[i] - f.lon) / d.lon, (lat[i] - f.lat) / d.lat);
		if (r > f.radius) f.radius = r;
	}
	return { ...tile, lon, lat, rel, index: raw.index, feature, features };
}

// ── loading ─────────────────────────────────────────

let implVersion: Promise<string> | null = null;

/** The current renderer version, which prefixes every tile URL, from the root tileset. */
export function resolveImplVersion(fetch = globalThis.fetch): Promise<string> {
	implVersion ??= (async () => {
		const res = await fetch(`${BUILDINGS_URL}/tileset.json`);
		if (!res.ok) throw new Error(`re:earth buildings: http ${res.status}`);
		const json = (await res.json()) as { root?: { content?: { uri?: string } } };
		const uri = json.root?.content?.uri ?? '';
		const m = uri.match(/^\/?([^/]+)\/sub\//);
		if (!m) throw new Error('re:earth buildings: unexpected tileset');
		return m[1];
	})();
	implVersion.catch(() => (implVersion = null));
	return implVersion;
}

export const tileUrl = (impl: string, t: TileId) =>
	`${BUILDINGS_URL}/${impl}/${t.z}/${t.x}/${t.y}.glb`;

let loader: GLTFLoader | null = null;

/** Read the arrays out of a GLB. */
export async function parseGlb(buffer: ArrayBuffer): Promise<RawTile | null> {
	if (!loader) {
		loader = new GLTFLoader();
		loader.setMeshoptDecoder(MeshoptDecoder);
	}
	const gltf = await loader.parseAsync(buffer, '');
	const nodes = (gltf.parser.json as { nodes?: { matrix?: number[] }[] }).nodes ?? [];
	const matrix = nodes.find((n) => n.matrix)?.matrix ?? new THREE.Matrix4().toArray();
	let found: RawTile | null = null;
	gltf.scene.traverse((o) => {
		if (found || !(o as THREE.Mesh).isMesh) return;
		const g = (o as THREE.Mesh).geometry;
		const pos = g.getAttribute('position');
		const fid = g.getAttribute('_feature_id_0');
		if (!pos || !g.index) return;
		found = {
			positions: pos.array as Float32Array,
			index: Uint32Array.from(g.index.array),
			featureIds: fid ? (fid.array as ArrayLike<number>) : new Uint32Array(pos.count),
			matrix
		};
	});
	return found;
}

const cache = new Map<string, Promise<BuildingTile | null>>();

/** A tile's buildings, through a cache; null where the service has no tile (empty ground). */
export function loadBuildingTile(
	t: TileId,
	fetch = globalThis.fetch
): Promise<BuildingTile | null> {
	const key = tileKey(t);
	let hit = cache.get(key);
	if (!hit) {
		hit = (async () => {
			const impl = await resolveImplVersion(fetch);
			const res = await fetch(tileUrl(impl, t));
			if (res.status === 404 || res.status === 204) return null;
			if (!res.ok) throw new Error(`re:earth buildings ${key}: http ${res.status}`);
			const buffer = await res.arrayBuffer();
			if (!buffer.byteLength) return null;
			const raw = await parseGlb(buffer);
			return raw ? decodeTile(raw, t) : null;
		})();
		hit.catch(() => cache.delete(key));
		cache.set(key, hit);
	}
	return hit;
}

// ── standing them on the ground ─────────────────────

/** Metres above sea level of each vertex, with every building's base on `ground` at its centroid. */
export function groundedHeights(tile: BuildingTile, ground: Elevation): Float32Array {
	const bases = tile.features.map((f) => {
		const g = ground(f.lon, f.lat);
		return Number.isFinite(g) ? Math.max(0, g) : 0;
	});
	const y = new Float32Array(tile.rel.length);
	for (let i = 0; i < y.length; i++) y[i] = bases[tile.feature[i]] + tile.rel[i];
	return y;
}

/** How a scene lays the globe out: metres east and north of its origin, and the drop of the earth. */
export interface LocalFrame {
	origin: LngLat;
	/**
	 * Leave out any building whose footprint takes in the origin: the one you stand in or on,
	 * which would otherwise wall in the view.
	 */
	clearOrigin?: boolean;
}

/** Local east/north metres of a point about the frame's origin. */
export function toLocal(frame: LocalFrame, lon: number, lat: number) {
	const k = RAD * EARTH_RADIUS;
	return {
		x: (lon - frame.origin.lon) * k * Math.cos(frame.origin.lat * RAD),
		north: (lat - frame.origin.lat) * k
	};
}

/** How far the earth has curved away, less refraction, at a horizontal distance. */
export const curvatureDrop = (d2: number) => ((1 - REFRACTION_K) * d2) / (2 * EARTH_RADIUS);

/**
 * A mesh of a tile in a scene's frame: x east, y up, z south, with the earth's curvature
 * applied as the terrain has it.
 */
export function buildingGeometry(
	tile: BuildingTile,
	ground: Elevation,
	frame: LocalFrame
): THREE.BufferGeometry {
	const heights = groundedHeights(tile, ground);
	const n = tile.rel.length;
	const pos = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		const { x, north } = toLocal(frame, tile.lon[i], tile.lat[i]);
		pos[3 * i] = x;
		pos[3 * i + 1] = heights[i] - curvatureDrop(x * x + north * north);
		pos[3 * i + 2] = -north;
	}
	let index = tile.index;
	if (frame.clearOrigin) {
		// A footprint's bounding box is close enough to say whether the origin is inside it.
		const m = tile.features.length;
		const box = new Float64Array(m * 4).fill(Infinity);
		for (let f = 0; f < m; f++) box[4 * f + 1] = box[4 * f + 3] = -Infinity;
		for (let i = 0; i < n; i++) {
			const f = tile.feature[i] * 4;
			const x = pos[3 * i],
				z = pos[3 * i + 2];
			box[f] = Math.min(box[f], x);
			box[f + 1] = Math.max(box[f + 1], x);
			box[f + 2] = Math.min(box[f + 2], z);
			box[f + 3] = Math.max(box[f + 3], z);
		}
		const hidden = (f: number) =>
			box[4 * f] <= 0 && box[4 * f + 1] >= 0 && box[4 * f + 2] <= 0 && box[4 * f + 3] >= 0;
		const kept: number[] = [];
		for (let t = 0; t < tile.index.length; t += 3)
			if (!hidden(tile.feature[tile.index[t]]))
				kept.push(tile.index[t], tile.index[t + 1], tile.index[t + 2]);
		if (kept.length < tile.index.length) index = Uint32Array.from(kept);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setIndex(new THREE.BufferAttribute(index, 1));
	geo.computeVertexNormals();
	return geo;
}

// ── in the way? ─────────────────────────────────────

export interface Obstruction {
	/** Metres from the eye to the building. */
	distance: number;
	/** Metres above sea level the line of sight passes there, and the building's top. */
	sightHeight: number;
	top: number;
}

/** Möller–Trumbore: distance along the ray to the triangle, or null. */
function rayTriangle(
	o: [number, number, number],
	d: [number, number, number],
	a: [number, number, number],
	b: [number, number, number],
	c: [number, number, number]
): number | null {
	const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
	const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
	if (Math.abs(det) < 1e-9) return null;
	const inv = 1 / det;
	const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
	const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
	if (u < 0 || u > 1) return null;
	const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
	const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
	if (v < 0 || u + v > 1) return null;
	const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
	return t > 0 ? t : null;
}

/**
 * The nearest building that the line of sight from an eye, looking along `bearing` and
 * `angle` degrees up, runs into within `maxDistance` metres. Tiles are read in a flat frame
 * about the eye; the earth's curvature over these distances is folded into the angle.
 */
export function obstruction(
	tiles: BuildingTile[],
	eye: LngLat & { elevation: number },
	bearing: number,
	angle: number,
	ground: Elevation,
	maxDistance = 15_000
): Obstruction | null {
	const frame: LocalFrame = { origin: eye };
	// Over the first several kilometres the ground falls away by about this much of a degree;
	// lifting the ray by it keeps the test honest to within a hundredth of a degree.
	const lift = Math.atan2(curvatureDrop((maxDistance / 2) ** 2), maxDistance / 2) * DEG;
	const a = (angle + lift) * RAD;
	const b = bearing * RAD;
	const dir: [number, number, number] = [
		Math.sin(b) * Math.cos(a),
		Math.sin(a),
		Math.cos(b) * Math.cos(a)
	];
	const o: [number, number, number] = [0, eye.elevation, 0];
	let best: Obstruction | null = null;
	const heights = new Map<BuildingTile, Float32Array>();
	for (const tile of tiles) {
		for (const f of tile.features) {
			const c = toLocal(frame, f.lon, f.lat);
			const along = c.x * dir[0] + c.north * dir[2];
			if (along < -f.radius || along > maxDistance) continue;
			const lateral = Math.abs(c.x * dir[2] - c.north * dir[0]);
			if (lateral > f.radius) continue;
			if (best && along - f.radius > best.distance) continue;
			const g = ground(f.lon, f.lat);
			const base = Number.isFinite(g) ? Math.max(0, g) : 0;
			const rayAt = eye.elevation + Math.tan(a) * Math.max(0, along - f.radius);
			if (base + f.height < rayAt) continue;
			let h = heights.get(tile);
			if (!h) heights.set(tile, (h = groundedHeights(tile, ground)));
			const v = (i: number): [number, number, number] => {
				const p = toLocal(frame, tile.lon[i], tile.lat[i]);
				return [p.x, h![i], p.north];
			};
			for (const t of f.triangles) {
				const hit = rayTriangle(
					o,
					dir,
					v(tile.index[t]),
					v(tile.index[t + 1]),
					v(tile.index[t + 2])
				);
				if (hit !== null && hit < maxDistance && (!best || hit < best.distance))
					best = {
						distance: hit,
						sightHeight: eye.elevation + Math.sin(a) * hit,
						top: base + f.height
					};
			}
		}
	}
	return best;
}

/** The tiles worth checking along a sightline: small buildings close by, big ones further out. */
export function sightlineTiles(eye: LngLat, bearing: number): TileId[] {
	return [
		...tilesAlong(eye, bearing, 1_500, 60, 14),
		...tilesAlong(eye, bearing, 6_000, 80, 13),
		...tilesAlong(eye, bearing, 15_000, 120, 12)
	];
}
