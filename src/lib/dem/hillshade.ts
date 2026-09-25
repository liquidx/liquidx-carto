import type { DemTile, HillshadeOptions } from './types.js';

const M_PER_DEG_LAT = 111_320;

/** Render a tile to a greyscale hillshade RGBA raster (Horn's method). NaN cells are transparent. */
export function renderHillshade(
	tile: DemTile,
	opts: HillshadeOptions
): { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
	const ds = Math.max(1, Math.floor(opts.downsample));
	const w = Math.floor(tile.width / ds);
	const h = Math.floor(tile.height / ds);
	const src = tile.data;
	const sw = tile.width;

	const latMid = (tile.north + tile.south) / 2;
	const cellY = ((tile.north - tile.south) / tile.height) * M_PER_DEG_LAT * ds;
	const cellX =
		((tile.east - tile.west) / tile.width) *
		M_PER_DEG_LAT *
		Math.cos((latMid * Math.PI) / 180) *
		ds;

	const az = ((360 - opts.azimuth + 90) * Math.PI) / 180;
	const alt = (opts.altitude * Math.PI) / 180;
	const sinAlt = Math.sin(alt);
	const cosAlt = Math.cos(alt);
	const zf = opts.zFactor;

	const rgba = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));

	// Sample with clamping so tile edges still get a plausible slope.
	const z = (x: number, y: number) => {
		x = Math.min(w - 1, Math.max(0, x));
		y = Math.min(h - 1, Math.max(0, y));
		return src[y * ds * sw + x * ds];
	};

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const o = (y * w + x) * 4;
			const zc = z(x, y);
			if (Number.isNaN(zc)) continue;
			const a = nz(z(x - 1, y - 1), zc);
			const b = nz(z(x, y - 1), zc);
			const c = nz(z(x + 1, y - 1), zc);
			const d = nz(z(x - 1, y), zc);
			const f = nz(z(x + 1, y), zc);
			const g = nz(z(x - 1, y + 1), zc);
			const hh = nz(z(x, y + 1), zc);
			const i = nz(z(x + 1, y + 1), zc);
			const dzdx = ((c + 2 * f + i - (a + 2 * d + g)) / (8 * cellX)) * zf;
			const dzdy = ((g + 2 * hh + i - (a + 2 * b + c)) / (8 * cellY)) * zf;
			const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
			const aspect = Math.atan2(dzdy, -dzdx);
			let shade = sinAlt * Math.cos(slope) + cosAlt * Math.sin(slope) * Math.cos(az - aspect);
			shade = Math.max(0, Math.min(1, shade));
			const v = shade * 255;
			rgba[o] = v;
			rgba[o + 1] = v;
			rgba[o + 2] = v;
			rgba[o + 3] = 255;
		}
	}
	return { rgba, width: w, height: h };
}

function nz(v: number, fallback: number) {
	return Number.isNaN(v) ? fallback : v;
}
