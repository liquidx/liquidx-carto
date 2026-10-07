import * as THREE from 'three';
import type { DioramaMeta } from './format.js';
import { RAMP_SIZE, terrainStyles, writeRamp } from './style.js';

/** An elevation lookup: metres at a longitude and latitude, NaN where there is no data. */
export type Sampler = (lon: number, lat: number) => number;

const M_PER_DEG_LAT = 111_320;

/** The ground area of a diorama: a circle centred on lon/lat. */
export interface Circle {
	lon: number;
	lat: number;
	/** Radius in metres. */
	radius: number;
}

export interface MeshParams {
	/** Rings from the centre to the rim; the ground spacing between vertices is radius / rings. */
	rings: number;
}

/** First vertex of ring k (k >= 1) on the top disc; ring k holds 6k vertices. */
const ringStart = (k: number) => 1 + 3 * k * (k - 1);

export interface VerticalParams {
	/** Vertical exaggeration. */
	exaggeration: number;
	/** Base thickness as a fraction of the radius. */
	baseDepth: number;
}

/** A diorama mesh as built, before it is written to a file. */
export interface DioramaData {
	geometry: THREE.BufferGeometry;
	/** Actual elevations (metres) per vertex, for the contour shader and re-scaling. */
	elev: Float32Array;
	/** 1 = vertex sits on the base plane. */
	isBase: Uint8Array;
	/** Per vertex, the top-disc vertex whose height is the terrain surface above it. */
	surfaceOf: Uint32Array;
	minZ: number;
	maxZ: number;
	radius: number;
	/** Centre of the circle in degrees. */
	lon: number;
	lat: number;
	/** Rings on the top disc: a centre vertex, then 6k vertices on each ring k. */
	rings: number;
	nodataFraction: number;
}

/**
 * Build a cylindrical "core sample" of terrain: disc on top, wall, and bottom cap.
 * The disc is concentric rings with 6k vertices on ring k, so vertices are evenly spaced
 * and the triangles close to equilateral from the centre out to the rim.
 * The result is normalised so the radius is 1 unit; heights are set by `applyVertical`.
 */
export function buildDiorama(sample: Sampler, sel: Circle, params: MeshParams): DioramaData {
	const { rings } = params;
	// Vertices around the rim, and so around the wall and bottom cap.
	const segments = rings * 6;
	const R = sel.radius;
	const cosLat = Math.cos((sel.lat * Math.PI) / 180);
	const degPerMx = 1 / (M_PER_DEG_LAT * cosLat);
	const degPerMy = 1 / M_PER_DEG_LAT;

	// --- top disc: centre + 6k vertices on each ring k ---
	const topCount = ringStart(rings + 1);
	const wallCount = segments * 2;
	const bottomCount = 1 + segments;
	const total = topCount + wallCount + bottomCount;

	const positions = new Float32Array(total * 3);
	const colors = new Float32Array(total * 3);
	const elev = new Float32Array(total);
	const isBase = new Uint8Array(total);
	// 1 on the top disc, 0 on the wall and bottom so contours only draw on the terrain surface.
	const contourMask = new Float32Array(total);
	contourMask.fill(1, 0, topCount);
	const surfaceOf = new Uint32Array(total);
	for (let i = 0; i < topCount; i++) surfaceOf[i] = i;

	const topElev = new Float32Array(topCount);
	let minZ = Infinity,
		maxZ = -Infinity,
		nodata = 0;

	// Lay out the rings (x east, z south so +z faces the viewer); the centre stays at 0, 0.
	const xy = new Float32Array(topCount * 2);
	for (let ring = 1, i = 1; ring <= rings; ring++) {
		const r = ring / rings;
		const count = ring * 6;
		for (let j = 0; j < count; j++, i++) {
			const theta = (j / count) * Math.PI * 2;
			xy[i * 2] = Math.cos(theta) * r; // east, normalised
			xy[i * 2 + 1] = Math.sin(theta) * r; // south
		}
	}
	// Sample elevations.
	for (let i = 0; i < topCount; i++) {
		const px = xy[i * 2];
		const pz = xy[i * 2 + 1];
		const lon = sel.lon + px * R * degPerMx;
		const lat = sel.lat - pz * R * degPerMy;
		const z = sample(lon, lat);
		topElev[i] = z;
		if (Number.isNaN(z)) nodata++;
		else {
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
	}
	if (!Number.isFinite(minZ)) {
		minZ = 0;
		maxZ = 1;
	}
	// Fill nodata with the minimum so it reads as a flat floor.
	for (let i = 0; i < topCount; i++) if (Number.isNaN(topElev[i])) topElev[i] = minZ;

	// Vertex colours in the topo style, for glTF viewers without the terrain shader.
	const ramp = new Uint8Array(RAMP_SIZE * 4);
	writeRamp(terrainStyles.topo.ramp, ramp);
	const range = Math.max(1e-6, maxZ - minZ);
	const col = new THREE.Color();
	for (let i = 0; i < topCount; i++) {
		positions[i * 3] = xy[i * 2];
		positions[i * 3 + 2] = xy[i * 2 + 1];
		elev[i] = topElev[i];
		const texel = Math.round(((topElev[i] - minZ) / range) * (RAMP_SIZE - 1)) * 4;
		col.setRGB(
			ramp[texel] / 255,
			ramp[texel + 1] / 255,
			ramp[texel + 2] / 255,
			THREE.SRGBColorSpace
		);
		colors[i * 3] = col.r;
		colors[i * 3 + 1] = col.g;
		colors[i * 3 + 2] = col.b;
	}

	// --- wall: duplicate outer ring (top) and add bottom ring ---
	const wallStart = topCount;
	const outerStart = ringStart(rings);
	const wallColor = [0.62, 0.5, 0.4];
	for (let s = 0; s < segments; s++) {
		const src = outerStart + s;
		const t = wallStart + s;
		const b = wallStart + segments + s;
		positions[t * 3] = positions[src * 3];
		positions[t * 3 + 2] = positions[src * 3 + 2];
		elev[t] = elev[src];
		positions[b * 3] = positions[src * 3];
		positions[b * 3 + 2] = positions[src * 3 + 2];
		elev[b] = minZ;
		isBase[b] = 1;
		surfaceOf[t] = src;
		surfaceOf[b] = src;
		for (let k = 0; k < 3; k++) {
			colors[t * 3 + k] = wallColor[k];
			colors[b * 3 + k] = wallColor[k] * 0.8;
		}
	}

	// --- bottom cap ---
	const bottomStart = wallStart + wallCount;
	isBase[bottomStart] = 1;
	elev[bottomStart] = minZ;
	for (let k = 0; k < 3; k++) colors[bottomStart * 3 + k] = wallColor[k] * 0.7;
	for (let s = 0; s < segments; s++) {
		const src = outerStart + s;
		const v = bottomStart + 1 + s;
		positions[v * 3] = positions[src * 3];
		positions[v * 3 + 2] = positions[src * 3 + 2];
		elev[v] = minZ;
		isBase[v] = 1;
		surfaceOf[v] = src;
		for (let k = 0; k < 3; k++) colors[v * 3 + k] = wallColor[k] * 0.7;
	}

	// --- indices ---
	const idx = new Uint32Array(3 * (6 * rings * rings + 3 * segments));
	let n = 0;
	const push = (...v: number[]) => {
		for (const i of v) idx[n++] = i;
	};
	// Each band between ring k and k + 1 is six sextants; a sextant has k edges on the inside
	// and k + 1 on the outside, zipped into 2k + 1 triangles. Ring 0 is the centre vertex.
	for (let k = 0; k < rings; k++) {
		const innerCount = k * 6;
		const outerCount = (k + 1) * 6;
		const outerStart = ringStart(k + 1);
		const inner = (j: number) => (k === 0 ? 0 : ringStart(k) + (j % innerCount));
		const outer = (j: number) => outerStart + (j % outerCount);
		for (let sext = 0; sext < 6; sext++) {
			const i0 = sext * k;
			const o0 = sext * (k + 1);
			for (let i = 0; i <= k; i++) {
				push(inner(i0 + i), outer(o0 + i + 1), outer(o0 + i));
				if (i < k) push(inner(i0 + i), inner(i0 + i + 1), outer(o0 + i + 1));
			}
		}
	}
	// wall
	for (let s = 0; s < segments; s++) {
		const s1 = (s + 1) % segments;
		const t0 = wallStart + s,
			t1 = wallStart + s1;
		const b0 = wallStart + segments + s,
			b1 = wallStart + segments + s1;
		push(t0, t1, b1, t0, b1, b0);
	}
	// bottom (facing down)
	for (let s = 0; s < segments; s++) {
		const a = bottomStart + 1 + s;
		const b = bottomStart + 1 + ((s + 1) % segments);
		push(bottomStart, a, b);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('elevation', new THREE.BufferAttribute(elev, 1));
	geometry.setAttribute('contourMask', new THREE.BufferAttribute(contourMask, 1));
	geometry.setAttribute('surfaceY', new THREE.BufferAttribute(new Float32Array(total), 1));
	geometry.setIndex(new THREE.BufferAttribute(idx, 1));

	return {
		geometry,
		elev,
		isBase,
		surfaceOf,
		minZ,
		maxZ,
		radius: R,
		lon: sel.lon,
		lat: sel.lat,
		rings,
		nodataFraction: nodata / topCount
	};
}

/** Set vertex heights for an exaggeration / base depth; cheap, no resampling. */
export function applyVertical(data: DioramaData, params: VerticalParams) {
	const pos = data.geometry.getAttribute('position') as THREE.BufferAttribute;
	const arr = pos.array as Float32Array;
	const scale = params.exaggeration / data.radius;
	for (let i = 0; i < data.elev.length; i++) {
		arr[i * 3 + 1] = data.isBase[i] ? -params.baseDepth : (data.elev[i] - data.minZ) * scale;
	}
	pos.needsUpdate = true;
	// Terrain height above each vertex, so the side texture can follow the surface.
	const surf = data.geometry.getAttribute('surfaceY') as THREE.BufferAttribute;
	const surfArr = surf.array as Float32Array;
	for (let i = 0; i < data.elev.length; i++) surfArr[i] = arr[data.surfaceOf[i] * 3 + 1];
	surf.needsUpdate = true;
	data.geometry.computeVertexNormals();
	data.geometry.computeBoundingSphere();
}

/** The settings to store with (or use to view) a mesh built by `buildDiorama`. */
export function dioramaMeta(
	data: DioramaData,
	settings: VerticalParams & { contourInterval: number; majorEvery: number }
): DioramaMeta {
	return {
		version: 2,
		minZ: data.minZ,
		maxZ: data.maxZ,
		radius: data.radius,
		lon: data.lon,
		lat: data.lat,
		rings: data.rings,
		exaggeration: settings.exaggeration,
		baseDepth: settings.baseDepth,
		contourInterval: settings.contourInterval,
		majorEvery: settings.majorEvery
	};
}
