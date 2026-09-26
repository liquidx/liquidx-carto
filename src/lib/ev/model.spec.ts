import { describe, expect, it } from 'vitest';
import {
	blackspots,
	decodeChargers,
	decodeGrid,
	distanceAt,
	gridCells,
	landStats,
	type RawGrid
} from './model';

// 4 × 3 grid, row 0 at the south. Land everywhere except the east column.
const raw: RawGrid = {
	lo0: 140,
	la0: 42,
	step: 0.1,
	nx: 4,
	ny: 3,
	mask: '111011101110',
	// A far patch in the west, two cells, and a lone far cell in the middle.
	dAll: '30,5,5,0,31,5,28,0,5,5,5,0',
	d24: '30,5,5,0,31,5,28,0,5,5,40,0'
};

describe('decodeGrid', () => {
	it('parses distances and blanks out sea cells', () => {
		const g = decodeGrid(raw);
		expect(g.all[0]).toBe(30);
		expect(g.all[3]).toBeNaN();
		expect(distanceAt(g, 'all', 140.2, 42.1)).toBe(28);
		expect(distanceAt(g, 'all', 140.3, 42)).toBeNaN();
		expect(distanceAt(g, 'all', 139, 42)).toBeNaN();
	});

	it('summarises land only', () => {
		const s = landStats(decodeGrid(raw), 'all');
		expect(s.max).toBe(31);
		expect(s.median).toBe(5);
	});

	it('emits one polygon per land cell', () => {
		const fc = gridCells(decodeGrid(raw));
		expect(fc.features).toHaveLength(9);
		expect(fc.features[0].properties).toEqual({ all: 30, h24: 30 });
	});
});

describe('blackspots', () => {
	it('floods contiguous land beyond the threshold, largest first', () => {
		const g = decodeGrid(raw);
		const spots = blackspots(g, 'all', 25);
		expect(spots.map((s) => s.cells)).toEqual([2, 1]);
		expect(spots[0].max).toBe(31);
		expect(spots[0].lon).toBeCloseTo(140);
		expect(spots[0].lat).toBeCloseTo(42.05);
	});

	it('uses the chosen network', () => {
		const g = decodeGrid(raw);
		// The 24h network adds a far cell right above the lone one, joining them.
		expect(blackspots(g, '24h', 25).map((s) => s.cells)).toEqual([2, 2]);
		expect(blackspots(g, 'all', 50)).toEqual([]);
	});
});

describe('decodeChargers', () => {
	it('unpacks the flag fields', () => {
		const [c] = decodeChargers([[141.3, 43.06, 'x', 3, 6, '9:00', 'addr', '']]);
		expect(c).toMatchObject({ dc: true, ac200: true, ac100: false });
		expect(c).toMatchObject({ open24h: false, cardRequired: true, emp: true, tesla: false });
	});
});
