import type { Grid } from './contour.js';
import { xToLon, yToLat, type MercatorBox } from './mercator.js';

/**
 * Sample a gridWidth × gridHeight grid over a mercator box from a lon/lat elevation sampler.
 * With `supersample` > 1 each grid point averages an n × n block of samples spanning one grid
 * cell, so fine source data (e.g. 1 m lidar) is box-filtered instead of aliased.
 */
export function sampleDemGrid(
	sample: (lon: number, lat: number) => number,
	box: MercatorBox,
	gridWidth: number,
	gridHeight: number,
	supersample = 1
): Grid {
	const n = Math.max(1, Math.round(supersample));
	const dx = (box.x1 - box.x0) / (gridWidth - 1);
	const dy = (box.y1 - box.y0) / (gridHeight - 1);
	// Sub-sample offsets within a cell, centred on the grid point.
	const offs = Array.from({ length: n }, (_, k) => (n === 1 ? 0 : (k + 0.5) / n - 0.5));

	const lons = new Float64Array(gridWidth * n);
	for (let i = 0; i < gridWidth; i++)
		for (let a = 0; a < n; a++) lons[i * n + a] = xToLon(box.x0 + (i + offs[a]) * dx);

	const data = new Float32Array(gridWidth * gridHeight);
	for (let j = 0; j < gridHeight; j++) {
		const lats = offs.map((o) => yToLat(box.y0 + (j + o) * dy));
		for (let i = 0; i < gridWidth; i++) {
			let sum = 0;
			let count = 0;
			for (const lat of lats) {
				for (let a = 0; a < n; a++) {
					const v = sample(lons[i * n + a], lat);
					if (!Number.isNaN(v)) {
						sum += v;
						count++;
					}
				}
			}
			// Treat a point as nodata unless most of its footprint has data.
			data[j * gridWidth + i] = count * 2 > n * n ? sum / count : NaN;
		}
	}
	return { width: gridWidth, height: gridHeight, data };
}
