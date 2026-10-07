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
 * Build the mapping for a diorama geometry. Reads the top disc's polar grid of vertices, so
 * lookups cost the same however dense the mesh is. Heights follow the geometry as it is now;
 * build a new surface after changing its exaggeration.
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

	// Top-disc vertex index: the centre, then `segments` vertices per ring.
	const vertex = (ring: number, seg: number) =>
		ring === 0 ? 0 : 1 + (ring - 1) * segments + (seg % segments);

	// The triangle under (x, z) and its barycentric weights, written into `tri` and `w`.
	const tri = [0, 0, 0];
	const w = [0, 0, 0];
	function locate(x: number, z: number) {
		let r = Math.hypot(x, z);
		if (r > 1) {
			x /= r;
			z /= r;
			r = 1;
		}
		const fr = Math.min(r * rings, rings - 1e-9);
		const ring = Math.floor(fr);
		const fs = ((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * segments;
		const seg = Math.floor(fs) % segments;
		if (ring === 0) {
			tri[0] = 0;
			tri[1] = vertex(1, seg);
			tri[2] = vertex(1, seg + 1);
		} else {
			// Each cell is split along the diagonal from its inner-start to its outer-end corner.
			const outerHalf = fr - ring > fs - Math.floor(fs);
			tri[0] = vertex(ring, seg);
			tri[1] = outerHalf ? vertex(ring + 1, seg) : vertex(ring, seg + 1);
			tri[2] = vertex(ring + 1, seg + 1);
		}
		const ax = position.getX(tri[0]),
			az = position.getZ(tri[0]);
		const bx = position.getX(tri[1]) - ax,
			bz = position.getZ(tri[1]) - az;
		const cx = position.getX(tri[2]) - ax,
			cz = position.getZ(tri[2]) - az;
		const det = bx * cz - cx * bz || 1e-12;
		w[1] = ((x - ax) * cz - cx * (z - az)) / det;
		w[2] = (bx * (z - az) - (x - ax) * bz) / det;
		w[0] = 1 - w[1] - w[2];
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
