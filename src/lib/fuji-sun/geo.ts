/** Great-circle geometry on a spherical earth, and how high distant things look. */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Mean earth radius in metres. */
export const EARTH_RADIUS = 6_371_008.8;

/**
 * Coefficient of terrestrial refraction: light bends down along the earth by this fraction of
 * its curvature, so distant things sit a little higher than straight-line geometry says. 0.13 is
 * the surveyor's standard-atmosphere value.
 */
export const REFRACTION_K = 0.13;

export interface LngLat {
	lon: number;
	lat: number;
}

export function distance(a: LngLat, b: LngLat): number {
	const dLat = (b.lat - a.lat) * RAD;
	const dLon = (b.lon - a.lon) * RAD;
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(s));
}

/** Initial bearing from a to b, clockwise from north in [0, 360). */
export function bearing(a: LngLat, b: LngLat): number {
	const phi1 = a.lat * RAD,
		phi2 = b.lat * RAD;
	const dLon = (b.lon - a.lon) * RAD;
	const y = Math.sin(dLon) * Math.cos(phi2);
	const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
	return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** The point `d` metres from `a` along bearing `brg`. */
export function destination(a: LngLat, brg: number, d: number): LngLat {
	const delta = d / EARTH_RADIUS;
	const theta = brg * RAD;
	const phi1 = a.lat * RAD;
	const lambda1 = a.lon * RAD;
	const phi2 = Math.asin(
		Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
	);
	const lambda2 =
		lambda1 +
		Math.atan2(
			Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
			Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
		);
	return { lon: ((lambda2 * DEG + 540) % 360) - 180, lat: phi2 * DEG };
}

/** Signed difference b − a in degrees, folded into (−180, 180]. */
export function angleDiff(a: number, b: number): number {
	return ((b - a + 540) % 360) - 180;
}

/**
 * The angle above the observer's horizontal at which a point `d` metres away and `dh` metres
 * higher appears, once the earth has curved away beneath it and the air has bent the light back
 * a little.
 */
export function apparentElevation(d: number, dh: number): number {
	if (d <= 0) return dh > 0 ? 90 : -90;
	const drop = ((1 - REFRACTION_K) * d * d) / (2 * EARTH_RADIUS);
	return Math.atan2(dh - drop, d) * DEG;
}
