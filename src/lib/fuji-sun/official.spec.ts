import { describe, expect, it } from 'vitest';
import { alignmentDays, diamondWindows } from './alignment';
import { OFFICIAL, type OfficialSpot } from './official';
import { jstMidnight } from './sun';

const DAY = 86_400_000;

/** For each published window, how many days our nearest best day is outside it (0: inside). */
function misses(s: OfficialSpot, year = 2026): number[] {
	const observer = { lon: s.lon, lat: s.lat, elevation: s.ground + s.eye };
	// Two years, so a window across new year comes out whole.
	const windows = diamondWindows([
		...alignmentDays(observer, year, s.phase),
		...alignmentDays(observer, year + 1, s.phase)
	]);
	return s.dates.map(([m1, d1, m2, d2]) => {
		const from = jstMidnight(year, m1, d1);
		const to = jstMidnight(m2 < m1 ? year + 1 : year, m2, d2);
		return Math.min(
			...windows.map((w) => Math.max(0, from - w.best.day, w.best.day - to) / DAY),
			Infinity
		);
	});
}

/**
 * Dates in the list that look wrong on its own terms. The soga hills above kozu lie north of
 * kayama's line to fuji, so the april sun, moving north, reaches them first; the list has them
 * six days apart the other way round, as if swapped. Azumayama's september day doesn't pair
 * with its april one as every neighbour's does (13 apr goes with 29 aug), nor does toda
 * bridge's november day with its january one.
 */
const SUSPECT = [
	'国府津・曽我丘陵ウォーキングコース',
	'栢山から見た富士（二宮尊徳の見た富士山）',
	'二宮町の「吾妻山」',
	'荒川下流(戸田橋)'
];

describe('the kanto bureau list', () => {
	const placed = OFFICIAL.filter((s) => !s.approx && !SUSPECT.includes(s.name));

	it('agrees to within a day on most published dates', () => {
		const all = placed.flatMap((s) => misses(s));
		const close = all.filter((d) => d <= 1).length;
		expect(all.length).toBeGreaterThan(150);
		expect(close / all.length).toBeGreaterThan(0.8);
	});

	it('finds every window from places well clear of the mountain', () => {
		// Further than 30 km out a geocoding error of a few hundred metres moves the day by one
		// at most; closer in, or around the solstices, it can move it by several.
		for (const s of placed.filter((s) => s.lon > 139.1 && s.dates.every(([m]) => m > 1 && m < 12)))
			expect(Math.max(...misses(s)), s.name).toBeLessThanOrEqual(3);
	});

	it('counts the near miss at the equinox, as the list does', () => {
		// From mount ono the sun steps over the summit between one day and the next in march
		// and september without its disc ever touching it.
		const ono = OFFICIAL.find((s) => s.name === '大野山')!;
		expect(Math.max(...misses(ono))).toBeLessThanOrEqual(1);
	});
});
