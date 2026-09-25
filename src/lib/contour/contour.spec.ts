import { describe, expect, it } from 'vitest';
import {
	autoInterval,
	blur,
	simplify,
	traceContours,
	toPathData,
	type ContourOptions,
	type Grid
} from './contour.js';
import { decodePixels } from './terrain-api.js';
import { latToY, lonToX, xToLon, yToLat } from './mercator.js';

function makeGrid(w: number, h: number, f: (i: number, j: number) => number): Grid {
	const data = new Float32Array(w * h);
	for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = f(i, j);
	return { width: w, height: h, data };
}

const opts = (o: Partial<ContourOptions> = {}): ContourOptions => ({
	interval: 10,
	majorEvery: 5,
	smoothing: 0,
	outWidth: 100,
	outHeight: 100,
	skipBelowSea: false,
	tolerance: 0,
	...o
});

describe('traceContours', () => {
	it('traces a ramp as straight open lines spanning the frame', () => {
		// z = i * 10 over 11 columns -> 0..100 m, output 100 px wide => 1 px per metre.
		const grid = makeGrid(11, 5, (i) => i * 10 + 5);
		const levels = traceContours(grid, opts({ outHeight: 40 }));
		expect(levels.map((l) => l.value)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
		const l20 = levels.find((l) => l.value === 20)!;
		expect(l20.lines).toHaveLength(1);
		const line = l20.lines[0];
		// Vertical line at x = 15 px, running from top edge (y = 0) to bottom edge (y = 40).
		const xs = line.filter((_, k) => k % 2 === 0);
		const ys = line.filter((_, k) => k % 2 === 1);
		for (const x of xs) expect(x).toBeCloseTo(15);
		expect(Math.min(...ys)).toBe(0);
		expect(Math.max(...ys)).toBe(40);
		expect(levels.find((l) => l.value === 50)!.major).toBe(true);
		expect(l20.major).toBe(false);
	});

	it('closes contours around a peak', () => {
		const grid = makeGrid(41, 41, (i, j) => 100 - Math.hypot(i - 20, j - 20) * 4);
		// 30–90 m stay inside the frame (radius <= 17.5 cells); 100 m is the summit point itself.
		const levels = traceContours(grid, opts()).filter((l) => l.value >= 30 && l.value < 100);
		expect(levels).toHaveLength(7);
		for (const l of levels) {
			expect(l.lines).toHaveLength(1);
			const line = l.lines[0];
			expect(line[0]).toBeCloseTo(line[line.length - 2]);
			expect(line[1]).toBeCloseTo(line[line.length - 1]);
		}
		// The 60 m contour is a circle of radius 10 cells = 25 px around the centre (50, 50).
		const c60 = levels.find((l) => l.value === 60)!.lines[0];
		for (let k = 0; k < c60.length; k += 2) {
			expect(Math.hypot(c60[k] - 50, c60[k + 1] - 50)).toBeCloseTo(25, 0);
		}
	});

	it('breaks lines around nodata instead of crossing it', () => {
		const grid = makeGrid(11, 11, (i, j) => (j === 5 ? NaN : i * 10 + 5));
		const l = traceContours(grid, opts()).find((l) => l.value === 50)!;
		expect(l.lines).toHaveLength(2);
	});

	it('skips sea floor but keeps the coastline', () => {
		const grid = makeGrid(11, 3, (i) => i * 10 - 45);
		const values = traceContours(grid, opts({ skipBelowSea: true })).map((l) => l.value);
		expect(values).toEqual([0, 10, 20, 30, 40, 50]);
	});
});

describe('blur', () => {
	it('keeps nodata as nodata and smooths neighbours', () => {
		const grid = makeGrid(5, 1, (i) => [0, 0, 10, 0, NaN][i]);
		const out = blur(grid, 1);
		expect(Number.isNaN(out.data[4])).toBe(true);
		expect(out.data[2]).toBeLessThan(10);
		expect(out.data[1]).toBeGreaterThan(0);
	});
});

describe('simplify', () => {
	it('drops collinear points', () => {
		const line = Float32Array.from([0, 0, 1, 0, 2, 0, 3, 0, 3, 1]);
		expect([...simplify(line, 0.1)]).toEqual([0, 0, 3, 0, 3, 1]);
	});
});

describe('helpers', () => {
	it('picks round intervals', () => {
		expect(autoInterval(1000)).toBe(25);
		expect(autoInterval(120)).toBe(5);
	});

	it('round-trips mercator coordinates', () => {
		expect(xToLon(lonToX(138.7))).toBeCloseTo(138.7);
		expect(yToLat(latToY(35.36))).toBeCloseTo(35.36);
	});

	it('formats path data', () => {
		expect(toPathData([Float32Array.from([0, 0, 1.25, 2])])).toBe('M0 0L1.3 2');
	});

	it('decodes terrarium and gsi pixels', () => {
		const px = Uint8ClampedArray.from([128, 0, 0, 255, 0, 0, 100, 255, 128, 0, 0, 255]);
		const t = decodePixels(px, 'terrarium');
		expect(t[0]).toBe(0);
		const g = decodePixels(px, 'gsi');
		expect(Number.isNaN(g[0])).toBe(true);
		expect(g[1]).toBeCloseTo(1);
	});
});
