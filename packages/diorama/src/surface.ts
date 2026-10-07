import * as THREE from 'three';
import type { DioramaMeta } from './format.js';

const M_PER_DEG_LAT = 111_320;

/** A position as `[lon, lat]` in degrees (WGS84), as in GeoJSON; further members are ignored. */
export type LonLat = readonly number[];

/**
 * Maps between geographic coordinates and a diorama mesh: the model has a radius of 1 with x
 * east, y up and z south, centred on the diorama's centre.
 */
export interface DioramaSurface {
	/** Model x and z for a position. Not limited to the disc. */
	toModel(lonLat: LonLat): [x: number, z: number];
	/** True when the position is inside the diorama's circle. */
	contains(lonLat: LonLat): boolean;
	/** Ground elevation in metres; positions outside the circle read the nearest point on the rim. */
	elevationAt(lonLat: LonLat): number;
	/** Model y of the terrain surface at a model x and z. */
	heightAt(x: number, z: number): number;
	/** Point on the terrain surface in model space, `altitude` metres above the ground. */
	project(lonLat: LonLat, altitude?: number, target?: THREE.Vector3): THREE.Vector3;
	/** A ground distance in metres as model units. */
	metres(n: number): number;
}

/**
 * Build the mapping for a diorama geometry. Reads the top disc's rings of vertices, so lookups
 * cost the same however dense the mesh is. Heights follow the geometry as it is now; build a
 * new surface after changing its exaggeration.
 */
export function createSurface(geometry: THREE.BufferGeometry, meta: DioramaMeta): DioramaSurface {
	const { rings, segments, radius } = meta;
	const position = geometry.getAttribute('position');
	const elevation = geometry.getAttribute('elevation');
	const cosLat = Math.cos((meta.lat * Math.PI) / 180);
	const perLon = (M_PER_DEG_LAT * cosLat) / radius;
	const perLat = M_PER_DEG_LAT / radius;

	const toModel = (p: LonLat): [number, number] => [
		(p[0] - meta.lon) * perLon,
		-(p[1] - meta.lat) * perLat
	];

	// The triangle under (x, z) and its barycentric weights, kept in `tri` and `w`.
	const tri = [0, 0, 0];
	const w = [0, 0, 0];
	/** Weigh (x, z) against a triangle; returns its smallest weight, negative when outside. */
	function weigh(x: number, z: number, a: number, b: number, c: number) {
		const ax = position.getX(a),
			az = position.getZ(a);
		const bx = position.getX(b) - ax,
			bz = position.getZ(b) - az;
		const cx = position.getX(c) - ax,
			cz = position.getZ(c) - az;
		const det = bx * cz - cx * bz || 1e-12;
		const wb = ((x - ax) * cz - cx * (z - az)) / det;
		const wc = (bx * (z - az) - (x - ax) * bz) / det;
		tri[0] = a;
		tri[1] = b;
		tri[2] = c;
		w[0] = 1 - wb - wc;
		w[1] = wb;
		w[2] = wc;
		return Math.min(w[0], wb, wc);
	}
	/** Angle of (x, z) round the disc as a fraction of a turn, from east through south. */
	const turn = (x: number, z: number) => (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;

	/** Older files: `count` vertices on every ring, each cell split along one diagonal. */
	function locateGrid(x: number, z: number, r: number, count: number) {
		const vertex = (ring: number, seg: number) =>
			ring === 0 ? 0 : 1 + (ring - 1) * count + (seg % count);
		const fr = Math.min(r * rings, rings - 1e-9);
		const ring = Math.floor(fr);
		const fs = turn(x, z) * count;
		const seg = Math.floor(fs) % count;
		if (ring === 0) return weigh(x, z, 0, vertex(1, seg), vertex(1, seg + 1));
		// The diagonal runs from the cell's inner-start corner to its outer-end corner.
		const outerHalf = fr - ring > fs - Math.floor(fs);
		return weigh(
			x,
			z,
			vertex(ring, seg),
			outerHalf ? vertex(ring + 1, seg) : vertex(ring, seg + 1),
			vertex(ring + 1, seg + 1)
		);
	}

	/**
	 * Ring k holds 6k vertices, and the band between rings k and k + 1 is six sextants, each
	 * zipped into 2k + 1 triangles. Rings are polygons, so near a ring the distance from the
	 * centre does not settle which band a point is in: try the likely triangles and keep the
	 * one that holds it, or failing that the nearest.
	 */
	const ringStart = (k: number) => 1 + 3 * k * (k - 1);
	function locateEven(x: number, z: number, r: number) {
		const sextant = Math.min(5, Math.floor(turn(x, z) * 6));
		const along = turn(x, z) * 6 - sextant;
		const guess = Math.min(rings - 1, Math.floor(r * rings));
		let best = -Infinity;
		let b0 = 0,
			b1 = 0,
			b2 = 0;
		const consider = (a: number, b: number, c: number) => {
			const fit = weigh(x, z, a, b, c);
			if (fit > best) {
				best = fit;
				b0 = a;
				b1 = b;
				b2 = c;
			}
			return fit >= -1e-9;
		};
		for (const k of [guess, guess - 1, guess + 1]) {
			if (k < 0 || k >= rings) continue;
			const inner = (j: number) => (k === 0 ? 0 : ringStart(k) + (j % (k * 6)));
			const outer = (j: number) => ringStart(k + 1) + (j % ((k + 1) * 6));
			const i0 = sextant * k;
			const o0 = sextant * (k + 1);
			// Triangles with an edge on the outer ring, then those with an edge on the inner one.
			const up = Math.min(k, Math.floor(along * (k + 1)));
			for (const i of [up, up - 1, up + 1]) {
				if (i < 0 || i > k) continue;
				if (consider(inner(i0 + i), outer(o0 + i + 1), outer(o0 + i))) return;
			}
			const down = Math.min(k - 1, Math.floor(along * k));
			for (const i of [down, down - 1, down + 1]) {
				if (i < 0 || i >= k) continue;
				if (consider(inner(i0 + i), inner(i0 + i + 1), outer(o0 + i + 1))) return;
			}
		}
		// Outside every candidate (past the rim, say): fall back on the closest.
		weigh(x, z, b0, b1, b2);
	}

	function locate(x: number, z: number) {
		let r = Math.hypot(x, z);
		if (r > 1) {
			x /= r;
			z /= r;
			r = 1;
		}
		if (segments) locateGrid(x, z, r, segments);
		else locateEven(x, z, r);
	}

	const blend = (get: (i: number) => number) =>
		get(tri[0]) * w[0] + get(tri[1]) * w[1] + get(tri[2]) * w[2];
	const getY = (i: number) => position.getY(i);
	const getElevation = (i: number) => elevation.getX(i);

	return {
		toModel,
		contains(p) {
			const [x, z] = toModel(p);
			return x * x + z * z <= 1;
		},
		elevationAt(p) {
			const [x, z] = toModel(p);
			locate(x, z);
			return blend(getElevation);
		},
		heightAt(x, z) {
			locate(x, z);
			return blend(getY);
		},
		project(p, altitude = 0, target = new THREE.Vector3()) {
			const [x, z] = toModel(p);
			locate(x, z);
			return target.set(x, blend(getY) + (altitude * meta.exaggeration) / radius, z);
		},
		metres: (n) => n / radius
	};
}
