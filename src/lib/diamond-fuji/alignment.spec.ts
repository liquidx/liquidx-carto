import { describe, expect, it } from 'vitest';
import {
	FUJI,
	alignmentDays,
	diamondLocus,
	diamondWindows,
	lineOfSight,
	sightline,
	skyline,
	type TerrainGrid
} from './alignment';
import { bearing, destination, distance } from './geo';
import { SUN_RADIUS, fmtDate, jstMidnight, sunPosition } from './sun';

/** Lake Yamanaka's north-east shore at Hirano, a classic diamond-fuji spot about 15 km east. */
const HIRANO = { lon: 138.8855, lat: 35.4175, elevation: 982 };
const flat = () => 0;

describe('geometry', () => {
	it('measures the summit from yamanakako', () => {
		const s = sightline(HIRANO);
		expect(s.distance / 1000).toBeCloseTo(15.7, 0);
		expect(s.bearing).toBeCloseTo(246, 0);
		// 2.8 km up over 15.7 km, less the curve of the earth.
		expect(s.summitAngle).toBeCloseTo(10.1, 0);
	});

	it('walks out and back', () => {
		const p = destination(FUJI, 75, 60_000);
		expect(distance(FUJI, p)).toBeCloseTo(60_000, -1);
		expect(bearing(FUJI, p)).toBeCloseTo(75, 1);
	});
});

describe('when', () => {
	it('has two diamond windows a year from the east shore, in autumn and late winter', () => {
		const days = alignmentDays(HIRANO, 2026, 'sunset');
		expect(days.length).toBeGreaterThan(300);
		const windows = diamondWindows(days);
		expect(windows).toHaveLength(2);
		// From Hirano the sun sets on the summit around late October and mid February.
		const months = windows.map((w) => new Date(w.best.day + 9 * 3_600_000).getUTCMonth() + 1);
		expect(months.sort((a, b) => a - b)).toEqual([2, 10]);
		for (const w of windows) {
			expect(Math.abs(w.best.offset)).toBeLessThanOrEqual(SUN_RADIUS);
			// At that instant the sun really is on the summit's bearing and height.
			const s = sunPosition(w.best.time, HIRANO.lat, HIRANO.lon);
			const line = sightline(HIRANO);
			expect(s.azimuth).toBeCloseTo(line.bearing, 2);
			expect(s.apparent - line.summitAngle).toBeCloseTo(w.best.offset, 6);
		}
	});

	it('finds nothing to the west of the mountain at sunset', () => {
		const west = { lon: 138.4, lat: 35.36, elevation: 500 };
		expect(diamondWindows(alignmentDays(west, 2026, 'sunset'))).toHaveLength(0);
		expect(diamondWindows(alignmentDays(west, 2026, 'sunrise')).length).toBeGreaterThan(0);
	});
});

describe('where', () => {
	it('traces a line east of fuji on which the sun sets on the summit', () => {
		const day = jstMidnight(2026, 11, 1);
		const pts = diamondLocus(day, 'sunset', flat, 1.6, { steps: 20 });
		expect(pts.length).toBeGreaterThan(15);
		for (const p of pts) {
			expect(p.lon).toBeGreaterThan(FUJI.lon);
			const line = sightline({ ...p, elevation: p.elevation });
			const s = sunPosition(p.time, p.lat, p.lon);
			expect(s.azimuth).toBeCloseTo(line.bearing, 1);
			expect(s.apparent).toBeCloseTo(line.summitAngle, 1);
		}
		// Further away the summit is lower in the sky, so the sun is further along its arc:
		// the line bends south as it goes out.
		const first = bearing(FUJI, pts[0]);
		const last = bearing(FUJI, pts.at(-1)!);
		expect(last).toBeGreaterThan(first);
	});

	it('reaches the dates the calendar found', () => {
		const windows = diamondWindows(alignmentDays(HIRANO, 2026, 'sunset'));
		const pts = diamondLocus(windows[0].best.day, 'sunset', () => HIRANO.elevation - 1.6, 1.6, {
			min: 15_000,
			max: 17_000,
			steps: 10
		});
		const nearest = Math.min(...pts.map((p) => distance(p, HIRANO)));
		// Within a few hundred metres: a day's drift of the sunset point at this range.
		expect(nearest).toBeLessThan(1500);
		expect(fmtDate(windows[0].best.day)).toMatch(/feb|oct|nov/);
	});
});

describe('the view', () => {
	/** A grid with one cone on it: a toy fuji. */
	function cone(): TerrainGrid {
		const width = 101,
			height = 101;
		const data = new Float32Array(width * height);
		const west = FUJI.lon - 0.25,
			east = FUJI.lon + 0.25,
			north = FUJI.lat + 0.2,
			south = FUJI.lat - 0.2;
		for (let j = 0; j < height; j++)
			for (let i = 0; i < width; i++) {
				const lon = west + ((east - west) * i) / (width - 1);
				const lat = north - ((north - south) * j) / (height - 1);
				const d = distance({ lon, lat }, FUJI);
				data[j * width + i] = Math.max(0, FUJI.elevation - d * 0.2);
			}
		return { west, east, north, south, width, height, data };
	}

	it('puts the summit at the top of the skyline', () => {
		const line = sightline(HIRANO);
		const sky = skyline(HIRANO, [cone()], line.bearing, 3, 0.05);
		const top = Math.max(...sky.angles);
		// The toy grid's cells are coarse, so the summit paints a plateau: take its middle.
		const bins = [...sky.angles].flatMap((a, i) => (a === top ? [i] : []));
		const at = sky.start + ((bins[0] + bins.at(-1)!) / 2) * sky.step;
		expect(at).toBeCloseTo(line.bearing, 0);
		expect(top).toBeCloseTo(line.summitAngle, 0);
	});

	it('sees the summit over flat ground and not through a wall', () => {
		expect(lineOfSight(HIRANO, flat).visible).toBe(true);
		const wall = (lon: number) => (Math.abs(lon - 138.8) < 0.005 ? 3900 : 0);
		const v = lineOfSight(HIRANO, wall);
		expect(v.visible).toBe(false);
		expect(v.blockedAt!.elevation).toBe(3900);
	});
});
