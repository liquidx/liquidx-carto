/**
 * Distance field: straight-line km from every land cell to the nearest fast charger (and to
 * the nearest one open 24h), on a 0.04° grid over Hokkaido.
 */
import type { RawGrid } from '../model.ts';
import { haversine, insideRing, type Ring } from './geo.ts';

export const GRID_BOUNDS = { lo0: 139.75, lo1: 145.9, la0: 41.35, la1: 45.6 };
export const GRID_STEP = 0.04;
/** Distances are capped, so a stray sea cell can't blow out the scale. */
const CAP_KM = 120;

export interface Site {
	lon: number;
	lat: number;
	open24h: boolean;
}

export function distanceGrid(land: Ring[], fast: Site[]): RawGrid {
	const { lo0, lo1, la0, la1 } = GRID_BOUNDS;
	const step = GRID_STEP;
	const nx = Math.floor((lo1 - lo0) / step) + 1;
	const ny = Math.floor((la1 - la0) / step) + 1;
	const fast24 = fast.filter((s) => s.open24h);
	const nearest = (lon: number, lat: number, sites: Site[]) => {
		let d = Infinity;
		for (const s of sites) d = Math.min(d, haversine(lon, lat, s.lon, s.lat));
		return Math.min(Math.round(d), CAP_KM);
	};

	const mask: string[] = [];
	const all: number[] = [];
	const h24: number[] = [];
	for (let iy = 0; iy < ny; iy++) {
		const lat = la0 + iy * step;
		for (let ix = 0; ix < nx; ix++) {
			const lon = lo0 + ix * step;
			const on = land.some((r) => insideRing(lon, lat, r));
			mask.push(on ? '1' : '0');
			all.push(on ? nearest(lon, lat, fast) : 0);
			h24.push(on ? nearest(lon, lat, fast24) : 0);
		}
	}
	return { lo0, la0, step, nx, ny, mask: mask.join(''), dAll: all.join(','), d24: h24.join(',') };
}
