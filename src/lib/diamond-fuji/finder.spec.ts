import { describe, expect, it } from 'vitest';
import { bandHalfWidth, closestApproach, findSpots, lineNear, overpassQuery } from './finder';
import { FUJI, diamondLocus } from './alignment';
import { destination, distance } from './geo';
import { SUN_RADIUS, jstMidnight } from './sun';

const flat = () => 0;

describe('the band', () => {
	it('is about a hundred metres wide each way at thirty kilometres', () => {
		expect(bandHalfWidth(30_000)).toBeGreaterThan(80);
		expect(bandHalfWidth(30_000)).toBeLessThan(120);
	});
});

describe('closest approach', () => {
	const line = [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 200, y: 0 }
	];
	it('finds a crossing street at the crossing', () => {
		const street = [
			{ x: 150, y: -50 },
			{ x: 150, y: 50 }
		];
		const a = closestApproach(street, line);
		expect(a.d).toBeCloseTo(0, 5);
		expect(a.on.x).toBeCloseTo(150);
		expect(a.segment).toBe(1);
	});
	it('measures a park that stops short of the line', () => {
		const ring = [
			{ x: 20, y: 30 },
			{ x: 80, y: 30 },
			{ x: 80, y: 90 },
			{ x: 20, y: 30 }
		];
		const a = closestApproach(ring, line);
		expect(a.d).toBeCloseTo(30);
		expect(a.on.y).toBe(30);
	});
});

describe('finding spots', () => {
	const day = jstMidnight(2026, 11, 1);
	// A kilometre off the day's line, about sixty kilometres out.
	const onLine = diamondLocus(day, 'sunset', flat, 1.6, { min: 60_000, max: 61_000, steps: 1 })[0];
	const centre = destination(onLine, 0, 1_000);

	it('re-solves the line finely near the centre', () => {
		const line = lineNear(day, 'sunset', centre, 5_000, flat);
		expect(line.length).toBeGreaterThan(20);
		for (let i = 1; i < line.length; i++) expect(distance(line[i - 1], line[i])).toBeLessThan(400);
	});

	it('asks overpass for things around the line', () => {
		const q = overpassQuery([centre, FUJI], 120);
		expect(q).toContain('around:120');
		expect(q).toContain('"tourism"="viewpoint"');
		expect(q).toContain('out tags geom');
	});

	it('keeps a street that crosses the line and drops one that misses it', async () => {
		const line = lineNear(day, 'sunset', centre, 5_000, flat);
		const mid = line[Math.floor(line.length / 2)];
		// A street running north–south through a point on the line, and another a kilometre north.
		const across = (p: { lon: number; lat: number }) => [
			{ lat: p.lat - 0.003, lon: p.lon },
			{ lat: p.lat + 0.003, lon: p.lon }
		];
		const far = destination(mid, 0, 1_000);
		const fetch = async () =>
			new Response(
				JSON.stringify({
					elements: [
						{
							type: 'way',
							id: 1,
							tags: { highway: 'residential', name: '本町通り' },
							geometry: across(mid)
						},
						{
							type: 'way',
							id: 2,
							tags: { highway: 'residential', name: 'far street' },
							geometry: across(far)
						},
						{
							type: 'node',
							id: 3,
							tags: { tourism: 'viewpoint', name: 'lookout' },
							lat: mid.lat,
							lon: mid.lon
						}
					]
				})
			);
		const r = await findSpots({ day, phase: 'sunset', centre, radius: 5_000, ground: flat, fetch });
		expect(r.candidates).toBe(3);
		expect(r.spots.map((s) => s.name).sort()).toEqual(['lookout', '本町通り']);
		for (const s of r.spots) {
			expect(Math.abs(s.offset)).toBeLessThanOrEqual(SUN_RADIUS);
			expect(s.visibility.visible).toBe(true);
			expect(s.offLine).toBeLessThan(50);
		}
	});
});
