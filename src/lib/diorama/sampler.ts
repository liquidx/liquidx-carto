import type { Grid } from '$lib/contour/contour';
import { latToY, lonToX, type MercatorBox } from '$lib/contour/mercator';

/** An elevation lookup: metres at lon/lat, NaN where there is no data. */
export type Sampler = (lon: number, lat: number) => number;

/**
 * Bilinear sampler over a grid spanning a mercator box (first row at y0). Falls back to the
 * nearest corner around nodata, and returns NaN outside the box.
 */
export function gridSampler(grid: Grid, box: MercatorBox): Sampler {
	const { width: w, height: h, data } = grid;
	const sx = (w - 1) / (box.x1 - box.x0);
	const sy = (h - 1) / (box.y1 - box.y0);
	return (lon, lat) => {
		const fx = (lonToX(lon) - box.x0) * sx;
		const fy = (latToY(lat) - box.y0) * sy;
		if (!(fx >= 0 && fy >= 0 && fx <= w - 1 && fy <= h - 1)) return NaN;
		const x0 = Math.min(w - 2, Math.floor(fx));
		const y0 = Math.min(h - 2, Math.floor(fy));
		const tx = fx - x0;
		const ty = fy - y0;
		const a = data[y0 * w + x0],
			b = data[y0 * w + x0 + 1],
			c = data[(y0 + 1) * w + x0],
			d = data[(y0 + 1) * w + x0 + 1];
		const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
		if (!Number.isNaN(v)) return v;
		return tx < 0.5 ? (ty < 0.5 ? a : c) : ty < 0.5 ? b : d;
	};
}
