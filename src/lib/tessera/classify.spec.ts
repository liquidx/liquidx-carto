import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import { BANDS } from './store';
import { fit, folds, probabilities, random, train, type Samples } from './model';
import { pngDataUrl, spans, traceAreas } from './classify';

describe('spans', () => {
	it('fills the pixels whose middles are inside, leaving holes out', () => {
		const outer = [
			[1, 1],
			[9, 1],
			[9, 9],
			[1, 9],
			[1, 1]
		];
		const hole = [
			[4, 4],
			[6, 4],
			[6, 6],
			[4, 6],
			[4, 4]
		];
		let filled = 0;
		spans([outer, hole], 10, 10, (_, a, b) => (filled += b - a));
		expect(filled).toBe(64 - 4);
	});
});

describe('traceAreas', () => {
	it('outlines a wood with its clearing, dropping specks smaller than the sieve', () => {
		const w = 40,
			h = 40;
		const p = new Float32Array(w * h);
		for (let r = 5; r < 35; r++) for (let c = 5; c < 35; c++) p[r * w + c] = 0.9;
		// A clearing of 8 × 8 inside, and a speck of 2 × 2 of trees well outside.
		for (let r = 16; r < 24; r++) for (let c = 16; c < 24; c++) p[r * w + c] = 0.1;
		p[1 * w + 38] = p[2 * w + 38] = p[1 * w + 37] = p[2 * w + 37] = 0.9;
		const woods = traceAreas(p, w, h, 0.5, 10);
		expect(woods).toHaveLength(1);
		expect(woods[0].holes).toHaveLength(1);
		// 30² less 8², give or take the half pixel the outline cuts between them.
		expect(woods[0].areaPx).toBeGreaterThan(30 * 30 - 8 * 8 - 40);
		expect(woods[0].areaPx).toBeLessThan(30 * 30 - 8 * 8 + 40);
	});
});

describe('model', () => {
	/** Clouds of unit vectors, one a class, apart along a band each; six labels a class. */
	function clouds(n: number, classes = 2): Samples {
		const rand = random(1);
		const x = new Float32Array(n * BANDS);
		const label = new Uint8Array(n);
		const group = new Int32Array(n);
		for (let i = 0; i < n; i++) {
			label[i] = i % classes;
			group[i] = i % (classes * 3);
			let sum = 0;
			for (let b = 0; b < BANDS; b++) {
				const v = (rand() - 0.5) * 0.4 + (b === label[i] ? 1 : 0);
				x[i * BANDS + b] = v;
				sum += v * v;
			}
			for (let b = 0; b < BANDS; b++) x[i * BANDS + b] /= Math.sqrt(sum);
		}
		return { x, label, group, classes };
	}

	const rightOf = (s: Samples, model: ReturnType<typeof fit>) => {
		let right = 0;
		for (let i = 0; i < s.label.length; i++) {
			const p = probabilities(model, s.x.subarray(i * BANDS, (i + 1) * BANDS));
			right += p.indexOf(Math.max(...p)) === s.label[i] ? 1 : 0;
		}
		return right / s.label.length;
	};
	const all = (n: number) => Array.from({ length: n }, (_, i) => i);

	it('separates two clouds, as one fit turned around', () => {
		const s = clouds(200);
		const model = fit(s, all(200), 0.1);
		expect(model.weights[1]).toEqual(model.weights[0].map((w) => -w));
		expect(rightOf(s, model)).toBeGreaterThan(0.97);
	});

	it('separates three, one against the rest', () => {
		const s = clouds(300, 3);
		const model = fit(s, all(300), 0.1);
		expect(model.weights).toHaveLength(3);
		expect(rightOf(s, model)).toBeGreaterThan(0.97);
		const { crossValidation } = train(s, ['a', 'b', 'c']);
		expect(Object.keys(crossValidation!.classes)).toEqual(['a', 'b', 'c']);
		expect(crossValidation!.accuracy).toBeGreaterThan(0.9);
	});

	it('holds out whole labels, each class in every fold', () => {
		const s = clouds(60);
		const held = folds(s)!;
		expect(held).toHaveLength(3);
		for (const fold of held) {
			const groups = new Set(Array.from(fold, (i) => s.group[i]));
			for (const other of held)
				if (other !== fold) for (const i of other) expect(groups.has(s.group[i])).toBe(false);
			expect(new Set(Array.from(fold, (i) => s.label[i])).size).toBe(2);
		}
	});
});

describe('pngDataUrl', () => {
	it('writes a PNG whose pixels read back', () => {
		const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128]);
		const url = pngDataUrl(rgba, 2, 1);
		const bytes = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
		expect(Array.from(bytes.subarray(1, 4), (b) => String.fromCharCode(b)).join('')).toBe('PNG');
		const length = new DataView(bytes.buffer).getUint32(33);
		const raw = unzlibSync(bytes.subarray(41, 41 + length));
		expect(Array.from(raw)).toEqual([0, ...rgba]);
	});
});
