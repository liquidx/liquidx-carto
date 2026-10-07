import { describe, expect, it } from 'vitest';
import { applyVertical, buildDiorama } from '@liquidx/diorama';
import { frameAt, frameBox } from '$lib/contour/mercator';
import { gridSampler } from './sampler';

const circle = { lon: 138.7, lat: 35.3, radius: 1000 };

describe('buildDiorama', () => {
	it('samples the disc and builds a closed mesh', () => {
		// A ramp rising eastwards: 100 m per 0.01° of longitude.
		const rings = 8;
		const d = buildDiorama((lon) => (lon - circle.lon) * 10_000 + 500, circle, { rings });
		// 6k vertices on ring k, so 48 around the rim, wall and bottom cap.
		const rim = rings * 6;
		const verts = 1 + 3 * rings * (rings + 1) + rim * 2 + 1 + rim;
		expect(d.elev.length).toBe(verts);
		const index = d.geometry.getIndex()!;
		expect(index.count).toBe(3 * (6 * rings * rings + rim * 2 + rim));
		// Closed: every edge is shared by two triangles, once in each direction.
		// (The wall and bottom duplicate the rim, so weld vertices by position first.)
		const pos = d.geometry.getAttribute('position');
		applyVertical(d, { exaggeration: 1, baseDepth: 0.25 });
		const weld = new Map<string, number>();
		const id = (i: number) => {
			const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
			if (!weld.has(key)) weld.set(key, weld.size);
			return weld.get(key)!;
		};
		const edges = new Map<string, number>();
		for (let t = 0; t < index.count; t += 3) {
			const v = [id(index.getX(t)), id(index.getX(t + 1)), id(index.getX(t + 2))];
			for (let e = 0; e < 3; e++) {
				const key = `${v[e]}>${v[(e + 1) % 3]}`;
				edges.set(key, (edges.get(key) ?? 0) + 1);
			}
		}
		for (const [key, n] of edges) {
			expect(n).toBe(1);
			expect(edges.get(key.split('>').reverse().join('>'))).toBe(1);
		}
		expect(d.minZ).toBeLessThan(500);
		expect(d.maxZ).toBeGreaterThan(500);
		expect(d.nodataFraction).toBe(0);
	});

	it('spaces vertices evenly from the centre to the rim', () => {
		const rings = 20;
		const d = buildDiorama(() => 0, circle, { rings });
		const pos = d.geometry.getAttribute('position');
		const index = d.geometry.getIndex()!;
		// Top surface triangles come first; every edge is close to one ring spacing long.
		let min = Infinity,
			max = 0;
		for (let t = 0; t < 6 * rings * rings * 3; t += 3) {
			for (let e = 0; e < 3; e++) {
				const a = index.getX(t + e),
					b = index.getX(t + ((e + 1) % 3));
				const len = Math.hypot(pos.getX(a) - pos.getX(b), pos.getZ(a) - pos.getZ(b));
				min = Math.min(min, len);
				max = Math.max(max, len);
			}
		}
		expect(min * rings).toBeGreaterThan(0.9);
		expect(max * rings).toBeLessThan(1.5);
	});

	it('fills nodata with the minimum and reports it', () => {
		const d = buildDiorama((lon) => (lon > circle.lon ? NaN : 100), circle, { rings: 4 });
		expect(d.nodataFraction).toBeGreaterThan(0.3);
		expect(d.minZ).toBe(100);
		expect(d.maxZ).toBe(100);
	});

	it('scales heights to the unit radius', () => {
		const d = buildDiorama((lon) => (lon > circle.lon ? 1000 : 0), circle, { rings: 4 });
		applyVertical(d, { exaggeration: 2, baseDepth: 0.25 });
		const y = d.geometry.getAttribute('position').array as Float32Array;
		const heights = Array.from({ length: d.elev.length }, (_, i) => y[i * 3 + 1]);
		// 1000 m of relief on a 1000 m radius at 2× is 2 units; the base sits at -0.25.
		expect(Math.max(...heights)).toBeCloseTo(2);
		expect(Math.min(...heights)).toBeCloseTo(-0.25);
	});
});

describe('gridSampler', () => {
	it('interpolates inside the box and is NaN outside', () => {
		const box = frameBox(frameAt(circle.lon, circle.lat, 2000), 1);
		const sample = gridSampler(
			{ width: 2, height: 2, data: new Float32Array([0, 10, 20, 30]) },
			box
		);
		expect(sample(circle.lon, circle.lat)).toBeCloseTo(15, 0);
		expect(sample(circle.lon + 1, circle.lat)).toBeNaN();
	});

	it('falls back to the nearest corner around nodata', () => {
		const box = frameBox(frameAt(circle.lon, circle.lat, 2000), 1);
		const sample = gridSampler(
			{ width: 2, height: 2, data: new Float32Array([5, NaN, NaN, NaN]) },
			box
		);
		expect(sample(circle.lon - 0.005, circle.lat + 0.004)).toBe(5);
	});
});
