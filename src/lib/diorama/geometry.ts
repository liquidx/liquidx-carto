import * as THREE from 'three';
import { rampColor } from './ramp';
import type { Sampler } from './sampler';

const M_PER_DEG_LAT = 111_320;

/** The ground area of a diorama: a circle centred on lon/lat. */
export interface Circle {
	lon: number;
	lat: number;
	/** Radius in metres. */
	radius: number;
}

export interface MeshParams {
	/** Radial rings on the disc. */
	rings: number;
	/** Angular segments around the disc. */
	segments: number;
}

export interface VerticalParams {
	/** Vertical exaggeration. */
	exaggeration: number;
	/** Base thickness as a fraction of the radius. */
	baseDepth: number;
}

export interface DioramaData {
	geometry: THREE.BufferGeometry;
	/** Actual elevations (metres) per vertex, for the contour shader and re-scaling. */
	elev: Float32Array;
	/** 1 = vertex sits on the base plane. */
	isBase: Uint8Array;
	minZ: number;
	maxZ: number;
	radius: number;
	nodataFraction: number;
}

/**
 * Build a cylindrical "core sample" of terrain: polar disc on top, wall, and bottom cap.
 * The result is normalised so the radius is 1 unit; heights are set by `applyVertical`.
 */
export function buildDiorama(sample: Sampler, sel: Circle, params: MeshParams): DioramaData {
	const { rings, segments } = params;
	const R = sel.radius;
	const cosLat = Math.cos((sel.lat * Math.PI) / 180);
	const degPerMx = 1 / (M_PER_DEG_LAT * cosLat);
	const degPerMy = 1 / M_PER_DEG_LAT;

	// --- top disc: centre + rings*segments vertices ---
	const topCount = 1 + rings * segments;
	const wallCount = segments * 2;
	const bottomCount = 1 + segments;
	const total = topCount + wallCount + bottomCount;

	const positions = new Float32Array(total * 3);
	const colors = new Float32Array(total * 3);
	const elev = new Float32Array(total);
	const isBase = new Uint8Array(total);

	const topElev = new Float32Array(topCount);
	let minZ = Infinity,
		maxZ = -Infinity,
		nodata = 0;

	// Sample elevations in polar layout (x east, z south so +z faces the viewer).
	const xy = new Float32Array(topCount * 2);
	for (let i = 0; i < topCount; i++) {
		let r = 0,
			theta = 0;
		if (i > 0) {
			const ring = Math.floor((i - 1) / segments) + 1;
			const seg = (i - 1) % segments;
			r = ring / rings;
			theta = (seg / segments) * Math.PI * 2;
		}
		const px = Math.cos(theta) * r; // east, normalised
		const pz = Math.sin(theta) * r; // south
		xy[i * 2] = px;
		xy[i * 2 + 1] = pz;
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

	const range = Math.max(1e-6, maxZ - minZ);
	const col = new Float32Array(3);
	for (let i = 0; i < topCount; i++) {
		positions[i * 3] = xy[i * 2];
		positions[i * 3 + 2] = xy[i * 2 + 1];
		elev[i] = topElev[i];
		rampColor((topElev[i] - minZ) / range, col);
		colors[i * 3] = col[0] / 255;
		colors[i * 3 + 1] = col[1] / 255;
		colors[i * 3 + 2] = col[2] / 255;
	}

	// --- wall: duplicate outer ring (top) and add bottom ring ---
	const wallStart = topCount;
	const outerStart = 1 + (rings - 1) * segments;
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
		for (let k = 0; k < 3; k++) colors[v * 3 + k] = wallColor[k] * 0.7;
	}

	// --- indices ---
	const idx = new Uint32Array(segments * 3 * (2 * rings + 2));
	let n = 0;
	const push = (...v: number[]) => {
		for (const i of v) idx[n++] = i;
	};
	// centre fan (ring 1)
	for (let s = 0; s < segments; s++) {
		const a = 1 + s;
		const b = 1 + ((s + 1) % segments);
		push(0, b, a);
	}
	for (let ring = 1; ring < rings; ring++) {
		const inner = 1 + (ring - 1) * segments;
		const outer = 1 + ring * segments;
		for (let s = 0; s < segments; s++) {
			const s1 = (s + 1) % segments;
			const a = inner + s,
				b = inner + s1,
				c = outer + s,
				d = outer + s1;
			push(a, d, c, a, b, d);
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
	geometry.setIndex(new THREE.BufferAttribute(idx, 1));

	return {
		geometry,
		elev,
		isBase,
		minZ,
		maxZ,
		radius: R,
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
	data.geometry.computeVertexNormals();
	data.geometry.computeBoundingSphere();
}
