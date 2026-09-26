/** Great-circle distance in km. */
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
	const R = 6371;
	const rad = Math.PI / 180;
	const p1 = lat1 * rad;
	const p2 = lat2 * rad;
	const dp = p2 - p1;
	const dl = (lon2 - lon1) * rad;
	const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

export type Ring = [number, number][];

/** Even-odd ray cast: is lon/lat inside a closed ring? */
export function insideRing(x: number, y: number, ring: Ring): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
	}
	return inside;
}

/** Round to `digits` decimal places. */
export const round = (v: number, digits: number) => Number(v.toFixed(digits));
