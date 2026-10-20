import { describe, expect, it } from 'vitest';
import {
	fmtTime,
	jstMidnight,
	refraction,
	solveTime,
	sunPosition,
	timeAtAltitude,
	timeAtAzimuth
} from './sun';

const TOKYO = { lat: 35.6762, lon: 139.6503 };

describe('sun position', () => {
	it('is highest at solar noon, with the declination of the solstice', () => {
		// Solar noon in Tokyo is about 11:43 JST: 139.65° east is 19 minutes ahead of the zone's
		// meridian, and the equation of time is two minutes behind in late June.
		const t = jstMidnight(2024, 6, 21) + (11 * 60 + 43) * 60_000;
		const s = sunPosition(t, TOKYO.lat, TOKYO.lon);
		expect(s.declination).toBeCloseTo(23.44, 1);
		expect(s.altitude).toBeCloseTo(90 - TOKYO.lat + 23.44, 1);
		expect(Math.abs(s.azimuth - 180)).toBeLessThan(1);
	});

	it('sets in tokyo at 19:00 on the june solstice and 16:32 on the december one', () => {
		// Sunset is when the upper limb meets the horizon: the centre is a radius below it, as seen.
		const june = timeAtAltitude(jstMidnight(2024, 6, 21), TOKYO.lat, TOKYO.lon, -0.27, 'sunset')!;
		const dec = timeAtAltitude(jstMidnight(2024, 12, 21), TOKYO.lat, TOKYO.lon, -0.27, 'sunset')!;
		const minutes = (t: number) => (t % 86_400_000) / 60_000;
		expect(minutes(june)).toBeCloseTo(minutes(jstMidnight(2024, 6, 21) + 19 * 3_600_000), -0.5);
		expect(minutes(dec)).toBeCloseTo(
			minutes(jstMidnight(2024, 12, 21) + (16 * 60 + 32) * 60_000),
			-0.5
		);
	});

	it('sets due west at the equinox', () => {
		const t = timeAtAltitude(jstMidnight(2025, 3, 20), TOKYO.lat, TOKYO.lon, 0, 'sunset')!;
		expect(sunPosition(t, TOKYO.lat, TOKYO.lon).azimuth).toBeCloseTo(270, 0);
	});

	it('rises in the east before noon', () => {
		const t = timeAtAltitude(jstMidnight(2025, 3, 20), TOKYO.lat, TOKYO.lon, 0, 'sunrise')!;
		expect(sunPosition(t, TOKYO.lat, TOKYO.lon).azimuth).toBeCloseTo(90, 0);
		expect(fmtTime(t)).toBe('05:47');
	});

	it('finds the time the sun is on a bearing', () => {
		const day = jstMidnight(2026, 11, 20);
		const t = timeAtAzimuth(day, TOKYO.lat, TOKYO.lon, 245, 'sunset')!;
		expect(sunPosition(t, TOKYO.lat, TOKYO.lon).azimuth).toBeCloseTo(245, 3);
		// Nothing sets in the north-east.
		expect(timeAtAzimuth(day, TOKYO.lat, TOKYO.lon, 45, 'sunset')).toBeNull();
	});

	it('refracts half a degree at the horizon and nothing overhead', () => {
		expect(refraction(0)).toBeCloseTo(0.48, 1);
		expect(refraction(45)).toBeCloseTo(0.016, 2);
		expect(refraction(89)).toBe(0);
	});

	it('bisects to a crossing', () => {
		expect(solveTime((t) => t - 1000, 0, 10_000, 1)).toBeCloseTo(1000, 0);
		expect(solveTime((t) => t + 1, 0, 10_000)).toBeNull();
	});
});
