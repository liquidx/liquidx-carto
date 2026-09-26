/**
 * Hokkaido coastline, simplified from dataofjapan/land (Douglas-Peucker, 0.018°) and stored
 * delta-encoded: rings separated by `|`, each a run of integers in thousandths of a degree,
 * the first pair absolute and the rest offsets from the previous point.
 */
import type { FeatureCollection, Polygon } from 'geojson';
import { round, type Ring } from './geo.ts';

export function decodeCoastline(text: string): Ring[] {
	return text.split('|').map((part) => {
		const v = part.trim().split(/\s+/).map(Number);
		let x = v[0];
		let y = v[1];
		const ring: Ring = [[x / 1000, y / 1000]];
		for (let i = 2; i < v.length; i += 2) {
			x += v[i];
			y += v[i + 1];
			ring.push([round(x / 1000, 3), round(y / 1000, 3)]);
		}
		const [first, last] = [ring[0], ring[ring.length - 1]];
		if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
		return ring;
	});
}

/**
 * Rings that count as land for the distance grid: the main island and Rebun/Rishiri. Rings 1–3
 * are the disputed Kurils, which have no chargers in the source and are left out.
 */
export const landRings = (rings: Ring[]) => [rings[0], rings[4]];

export function outlineGeoJson(rings: Ring[]): FeatureCollection<Polygon> & { name: string } {
	return {
		type: 'FeatureCollection',
		name: 'hokkaido_outline_simplified',
		features: rings.map((r, i) => ({
			type: 'Feature',
			properties: { name: 'Hokkaido', ring: i },
			geometry: { type: 'Polygon', coordinates: [r] }
		}))
	};
}
