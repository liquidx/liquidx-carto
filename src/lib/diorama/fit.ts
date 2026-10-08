import type { Position } from 'geojson';

const M_PER_DEG_LAT = 111_320;

/** The circle a diorama covers: its centre in degrees and its radius in metres. */
export interface FitCircle {
	lon: number;
	lat: number;
	radius: number;
}

/**
 * The circle around the middle of some positions that holds them all, with `margin` as a
 * factor on its radius.
 */
export function fitCircle(points: Position[], margin = 1.12): FitCircle {
	let west = Infinity,
		east = -Infinity,
		south = Infinity,
		north = -Infinity;
	for (const [lon, lat] of points) {
		west = Math.min(west, lon);
		east = Math.max(east, lon);
		south = Math.min(south, lat);
		north = Math.max(north, lat);
	}
	const lon = (west + east) / 2;
	const lat = (south + north) / 2;
	const perLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
	let reach = 0;
	for (const p of points)
		reach = Math.max(reach, Math.hypot((p[0] - lon) * perLon, (p[1] - lat) * M_PER_DEG_LAT));
	return { lon, lat, radius: reach * margin };
}

/** The square around a circle as `[west, south, east, north]`, with `margin` as a factor. */
export function circleBounds(
	circle: FitCircle,
	margin = 1.05
): [west: number, south: number, east: number, north: number] {
	const dLat = (circle.radius * margin) / M_PER_DEG_LAT;
	const dLon = dLat / Math.cos((circle.lat * Math.PI) / 180);
	return [circle.lon - dLon, circle.lat - dLat, circle.lon + dLon, circle.lat + dLat];
}
