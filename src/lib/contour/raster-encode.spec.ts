import { describe, expect, it } from 'vitest';
import { encodeBmp, encodeBmp1, encodeTiff, hexToRgb, type Pixels } from './raster-encode.js';

// 3 × 2 image: top row red, green, blue; bottom row white, black, grey.
const px: Pixels = {
	width: 3,
	height: 2,
	data: Uint8ClampedArray.from([
		255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128,
		255
	])
};

describe('encodeBmp', () => {
	it('writes a bottom-up BGR bitmap with padded rows', () => {
		const b = encodeBmp(px);
		const v = new DataView(b.buffer);
		expect(String.fromCharCode(b[0], b[1])).toBe('BM');
		expect(v.getUint32(2, true)).toBe(b.length);
		expect(v.getInt32(18, true)).toBe(3);
		expect(v.getInt32(22, true)).toBe(2);
		expect(v.getUint16(28, true)).toBe(24);
		// Rows are 9 bytes of pixels padded to 12; 54-byte header.
		expect(b.length).toBe(54 + 12 * 2);
		// First stored row is the bottom row: white, black, grey (as BGR).
		expect([...b.slice(54, 63)]).toEqual([255, 255, 255, 0, 0, 0, 128, 128, 128]);
		// Second stored row is the top row: red, green, blue (as BGR).
		expect([...b.slice(66, 75)]).toEqual([0, 0, 255, 0, 255, 0, 255, 0, 0]);
	});
});

describe('encodeTiff', () => {
	it('writes a baseline little-endian RGB TIFF', () => {
		const t = encodeTiff(px, 144);
		const v = new DataView(t.buffer);
		expect(String.fromCharCode(t[0], t[1])).toBe('II');
		expect(v.getUint16(2, true)).toBe(42);
		const ifd = v.getUint32(4, true);
		const n = v.getUint16(ifd, true);
		const tags = new Map<number, number>();
		let prev = 0;
		for (let k = 0; k < n; k++) {
			const o = ifd + 2 + k * 12;
			const tag = v.getUint16(o, true);
			expect(tag).toBeGreaterThan(prev);
			prev = tag;
			const short = v.getUint16(o + 2, true) === 3 && v.getUint32(o + 4, true) === 1;
			tags.set(tag, short ? v.getUint16(o + 8, true) : v.getUint32(o + 8, true));
		}
		expect(tags.get(256)).toBe(3);
		expect(tags.get(257)).toBe(2);
		expect(tags.get(262)).toBe(2);
		expect(v.getUint32(tags.get(282)!, true)).toBe(144);
		const strip = tags.get(273)!;
		expect(tags.get(279)).toBe(18);
		expect(strip + 18).toBe(t.length);
		expect([...t.slice(strip, strip + 6)]).toEqual([255, 0, 0, 0, 255, 0]);
	});
});

describe('encodeBmp1', () => {
	it('writes a two-colour palette and packs pixels MSB first', () => {
		// 10 × 1 on white: black, 50% grey (anti-aliased hairline), 80% white, then white.
		const w = 10;
		const data = new Uint8ClampedArray(w * 4).fill(255);
		data.set([0, 0, 0, 255, 128, 128, 128, 255, 204, 204, 204, 255], 0);
		const b = encodeBmp1({ width: w, height: 1, data }, hexToRgb('#fff'), hexToRgb('#000000'));
		const v = new DataView(b.buffer);
		expect(v.getUint16(28, true)).toBe(1);
		expect(v.getUint32(10, true)).toBe(62);
		// Rows pad to 4 bytes.
		expect(b.length).toBe(62 + 4);
		expect([...b.slice(54, 62)]).toEqual([255, 255, 255, 0, 0, 0, 0, 0]);
		// Black and the grey hairline are ink; 20% grey is not: 0b1100_0000.
		expect(b[62]).toBe(0b11000000);
		expect(b[63]).toBe(0);
	});

	it('follows inverted styles', () => {
		const data = Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255]);
		const b = encodeBmp1({ width: 2, height: 1, data }, [0, 0, 0], [255, 255, 255]);
		expect(b[62]).toBe(0b10000000);
	});
});
