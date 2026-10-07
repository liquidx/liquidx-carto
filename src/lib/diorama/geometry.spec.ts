import { describe, expect, it } from 'vitest';
import { applyVertical, buildDiorama } from '@liquidx/diorama';
import { frameAt, frameBox } from '$lib/contour/mercator';
import { gridSampler } from './sampler';

const circle = { lon: 138.7, lat: 35.3, radius: 1000 };

describe('buildDiorama', () => {
	it('samples the disc and builds a closed mesh', () => {
		// A ramp rising eastwards: 100 m per 0.01° of longitude.
		const d = buildDiorama((lon) => (lon - circle.lon) * 10_000 + 500, circle, {
			rings: 8,
			segments: 16
		});
		const verts = 1 + 8 * 16 + 16 * 2 + 1 + 16;
		expect(d.elev.length).toBe(verts);
		expect(d.geometry.getIndex()!.count).toBe(16 * 6 * (8 + 1));
		expect(d.minZ).toBeLessThan(500);
		expect(d.maxZ).toBeGreaterThan(500);
		expect(d.nodataFraction).toBe(0);
	});

	it('fills nodata with the minimum and reports it', () => {
		const d = buildDiorama((lon) => (lon > circle.lon ? NaN : 100), circle, {
			rings: 4,
			segments: 8
		});
		expect(d.nodataFraction).toBeGreaterThan(0.3);
		expect(d.minZ).toBe(100);
		expect(d.maxZ).toBe(100);
	});

	it('scales heights to the unit radius', () => {
		const d = buildDiorama((lon) => (lon > circle.lon ? 1000 : 0), circle, {
			rings: 4,
			segments: 8
		});
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
