import { describe, expect, it } from 'vitest';
import { FUJI, type TerrainGrid } from './alignment';
import { viewshed, viewshedImage } from './viewshed';

/** Flat ground with one ridge: a north–south wall about 30 km east of the summit, 1500 m high and a few cells wide. */
function world(): { region: TerrainGrid; mountain: TerrainGrid } {
	const make = (
		west: number,
		east: number,
		south: number,
		north: number,
		n: number,
		z: (lon: number, lat: number) => number
	): TerrainGrid => {
		const data = new Float32Array(n * n);
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++)
				data[j * n + i] = z(
					west + ((east - west) * i) / (n - 1),
					north - ((north - south) * j) / (n - 1)
				);
		return { west, east, south, north, width: n, height: n, data };
	};
	const ridge = (lon: number) => (Math.abs(lon - (FUJI.lon + 0.33)) < 0.06 ? 1500 : 0);
	return {
		region: make(FUJI.lon - 1.5, FUJI.lon + 1.5, FUJI.lat - 1, FUJI.lat + 1, 64, ridge),
		mountain: make(FUJI.lon - 0.2, FUJI.lon + 0.2, FUJI.lat - 0.15, FUJI.lat + 0.15, 32, () => 0)
	};
}

describe('viewshed', () => {
	const { region, mountain } = world();
	const w = 48,
		h = 32;
	const v = viewshed(region, mountain, { width: w, height: h, eye: 1.6, samples: 80 });
	const at = (lon: number, lat: number) => {
		const i = Math.floor(((lon - region.west) / (region.east - region.west)) * w);
		const j = Math.floor(((region.north - lat) / (region.north - region.south)) * h);
		return v[j * w + i];
	};

	it('sees the whole mountain over open ground', () => {
		expect(at(FUJI.lon - 0.8, FUJI.lat)).toBeGreaterThan(0.9);
		expect(at(FUJI.lon, FUJI.lat - 0.6)).toBeGreaterThan(0.9);
	});

	it('sees only the top from just behind the ridge, and more from further back', () => {
		const close = at(FUJI.lon + 0.4, FUJI.lat);
		const far = at(FUJI.lon + 1.3, FUJI.lat);
		expect(close).toBeLessThan(0.5);
		expect(far).toBeGreaterThan(close);
	});

	it('paints visible cells and leaves hidden ones clear', () => {
		const px = viewshedImage(Float32Array.from([0, 0.5, 1]));
		expect(px[3]).toBe(0);
		expect(px[7]).toBeGreaterThan(0);
		expect(px[11]).toBeGreaterThan(px[7]);
	});
});
