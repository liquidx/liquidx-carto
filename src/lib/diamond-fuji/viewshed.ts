/**
 * Where the mountain can be seen from: for every cell of a grid over the region, how much of
 * Fuji shows above the terrain in between, from an eye a little above the ground.
 */
import { apparentElevation, distance, type LngLat } from './geo';
import { FUJI, type TerrainGrid } from './alignment';

/** The mountain stands this far above where its cone usually disappears behind nearer hills. */
const CONE_DEPTH = 1300;
/** Ground within this distance of the summit is the mountain itself, not something in the way. */
const SELF = 2_500;

export interface ViewshedOptions {
	/** Cells across and down; the region box is sampled evenly in mercator, like the grids. */
	width: number;
	height: number;
	/** Eye height above the ground, metres. */
	eye: number;
	/** Samples along each line of sight. */
	samples?: number;
}

/** Bilinear sample of a grid stored north row first, evenly spaced in mercator y. */
function sampler(g: TerrainGrid) {
	const { west, east, width: w, height: h, data } = g;
	const y0 = latToY(g.north),
		y1 = latToY(g.south);
	return (lon: number, lat: number): number => {
		const fx = ((lon - west) / (east - west)) * (w - 1);
		const fy = ((latToY(lat) - y0) / (y1 - y0)) * (h - 1);
		if (!(fx >= 0 && fy >= 0 && fx <= w - 1 && fy <= h - 1)) return NaN;
		const x0 = Math.min(w - 2, Math.floor(fx)),
			yy = Math.min(h - 2, Math.floor(fy));
		const tx = fx - x0,
			ty = fy - yy;
		const a = data[yy * w + x0],
			b = data[yy * w + x0 + 1],
			c = data[(yy + 1) * w + x0],
			d = data[(yy + 1) * w + x0 + 1];
		return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
	};
}

function latToY(lat: number) {
	const s = Math.sin((lat * Math.PI) / 180);
	return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
function yToLat(y: number) {
	return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/**
 * How much of the mountain shows from each cell, 0 (none) to 1 (the whole cone), over the
 * region grid's extent. The mountain grid, where it applies, gives the finer ground.
 */
export function viewshed(
	region: TerrainGrid,
	mountain: TerrainGrid,
	{ width, height, eye, samples = 110 }: ViewshedOptions
): Float32Array {
	const coarse = sampler(region);
	const fine = sampler(mountain);
	const ground = (lon: number, lat: number) => {
		const f = fine(lon, lat);
		return Number.isNaN(f) ? coarse(lon, lat) : f;
	};
	const out = new Float32Array(width * height);
	const y0 = latToY(region.north),
		y1 = latToY(region.south);
	for (let j = 0; j < height; j++) {
		const lat = yToLat(y0 + ((y1 - y0) * (j + 0.5)) / height);
		for (let i = 0; i < width; i++) {
			const lon = region.west + ((region.east - region.west) * (i + 0.5)) / width;
			const g = ground(lon, lat);
			if (Number.isNaN(g)) continue;
			const p: LngLat = { lon, lat };
			const elevation = Math.max(0, g) + eye;
			const d = distance(p, FUJI);
			if (d < SELF) {
				out[j * width + i] = 1;
				continue;
			}
			const summit = apparentElevation(d, FUJI.elevation - elevation);
			let worst = -90;
			// Straight in lon/lat is near enough a great circle over these distances.
			for (let k = 1; k < samples; k++) {
				const t = k / samples;
				const dk = d * t;
				if (dk > d - SELF) break;
				const z = ground(lon + (FUJI.lon - lon) * t, lat + (FUJI.lat - lat) * t);
				if (Number.isNaN(z)) continue;
				const a = apparentElevation(dk, z - elevation);
				if (a > worst) worst = a;
			}
			const margin = ((summit - worst) * Math.PI) / 180;
			out[j * width + i] = Math.max(0, Math.min(1, (margin * d) / CONE_DEPTH));
		}
	}
	return out;
}

/** The viewshed as RGBA pixels: one colour, more opaque the more of the mountain shows. */
export function viewshedImage(
	fractions: Float32Array,
	rgb: [number, number, number] = [54, 182, 233],
	maxAlpha = 0.6
): Uint8ClampedArray {
	const px = new Uint8ClampedArray(fractions.length * 4);
	for (let i = 0; i < fractions.length; i++) {
		const f = fractions[i];
		if (f <= 0) continue;
		px[4 * i] = rgb[0];
		px[4 * i + 1] = rgb[1];
		px[4 * i + 2] = rgb[2];
		// A sliver of summit still counts: lift the low end so it shows.
		px[4 * i + 3] = Math.round(255 * maxAlpha * (0.25 + 0.75 * f));
	}
	return px;
}
