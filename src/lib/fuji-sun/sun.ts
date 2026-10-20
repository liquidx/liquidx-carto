/**
 * Where the sun is in the sky, from the NOAA solar calculator's algorithm (Meeus, Astronomical
 * Algorithms). Good to about 0.01° between 1900 and 2100, which is well within the width of the
 * sun itself. Times are JavaScript epoch milliseconds (UTC); angles are degrees.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Half the sun's apparent diameter: 32′ across, so 16′ to its edge. */
export const SUN_RADIUS = 0.2665;

export interface SunPosition {
	/** Compass bearing of the sun, clockwise from north. */
	azimuth: number;
	/** Geometric altitude above the horizon, with no atmosphere. */
	altitude: number;
	/** Altitude as seen, lifted by atmospheric refraction near the horizon. */
	apparent: number;
	declination: number;
}

/** Atmospheric refraction in degrees for a geometric altitude, as NOAA applies it. */
export function refraction(altitude: number): number {
	if (altitude > 85) return 0;
	const t = Math.tan(altitude * RAD);
	if (altitude > 5) return (58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5) / 3600;
	if (altitude > -0.575) {
		const h = altitude;
		return (1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)))) / 3600;
	}
	return -20.774 / t / 3600;
}

export function sunPosition(time: number, lat: number, lon: number): SunPosition {
	const jd = time / 86_400_000 + 2_440_587.5;
	const T = (jd - 2_451_545) / 36_525;
	const L0 = (280.46646 + T * (36_000.76983 + T * 0.0003032)) % 360;
	const M = 357.52911 + T * (35_999.05029 - T * 0.0001537);
	const e = 0.016708634 - T * (0.000042037 + T * 0.0000001267);
	const Mr = M * RAD;
	const C =
		Math.sin(Mr) * (1.914602 - T * (0.004817 + T * 0.000014)) +
		Math.sin(2 * Mr) * (0.019993 - T * 0.000101) +
		Math.sin(3 * Mr) * 0.000289;
	const trueLong = L0 + C;
	const omega = (125.04 - 1934.136 * T) * RAD;
	const lambda = (trueLong - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
	const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
	const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;
	const declination = Math.asin(Math.sin(eps) * Math.sin(lambda));

	const y = Math.tan(eps / 2) ** 2;
	const L0r = L0 * RAD;
	const eqTime =
		4 *
		DEG *
		(y * Math.sin(2 * L0r) -
			2 * e * Math.sin(Mr) +
			4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
			0.5 * y * y * Math.sin(4 * L0r) -
			1.25 * e * e * Math.sin(2 * Mr));

	const minutesUtc = (((time / 60_000) % 1440) + 1440) % 1440;
	const trueSolar = (((minutesUtc + eqTime + 4 * lon) % 1440) + 1440) % 1440;
	let hourAngle = trueSolar / 4 - 180;
	if (hourAngle < -180) hourAngle += 360;

	const phi = lat * RAD;
	const H = hourAngle * RAD;
	const cosZ =
		Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(H);
	const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ)));
	const altitude = 90 - zenith * DEG;

	let azimuth: number;
	const sinZ = Math.sin(zenith);
	if (sinZ < 1e-9) {
		azimuth = 180;
	} else {
		const cosAz = (Math.sin(phi) * cosZ - Math.sin(declination)) / (Math.cos(phi) * sinZ);
		const a = Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG;
		azimuth = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
	}

	return {
		azimuth,
		altitude,
		apparent: altitude + refraction(altitude),
		declination: declination * DEG
	};
}

// ── japan standard time ─────────────────────────────

/** Japan has one time zone and no summer time, so JST is always UTC+9. */
export const JST_OFFSET_MS = 9 * 3_600_000;

/** Midnight JST at the start of a calendar day, as epoch milliseconds. */
export function jstMidnight(year: number, month: number, day: number): number {
	return Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
}

/** The civil date and time in JST of an instant. */
export function jstParts(time: number) {
	const d = new Date(time + JST_OFFSET_MS);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds()
	};
}

export function isLeapYear(year: number) {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number) {
	return isLeapYear(year) ? 366 : 365;
}

/** Midnight JST on the `doy`-th day of a year (1 = 1 January). */
export function jstDay(year: number, doy: number): number {
	return jstMidnight(year, 1, 1) + (doy - 1) * 86_400_000;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** `12 oct` */
export function fmtDate(time: number) {
	const { day, month } = jstParts(time);
	return `${day} ${MONTHS[month - 1]}`;
}

/** `2026-10-12` */
export function fmtIsoDate(time: number) {
	const { year, month, day } = jstParts(time);
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `16:52` in JST. */
export function fmtTime(time: number) {
	const { hour, minute } = jstParts(time + 30_000);
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ── solving for a time ──────────────────────────────

/**
 * Bisect for the instant in [t0, t1] where `f` crosses zero, assuming it changes sign over the
 * interval; null when it doesn't.
 */
export function solveTime(
	f: (t: number) => number,
	t0: number,
	t1: number,
	tolMs = 250
): number | null {
	let a = t0,
		b = t1;
	let fa = f(a);
	const fb = f(b);
	if (Number.isNaN(fa) || Number.isNaN(fb) || fa * fb > 0) return null;
	if (fa === 0) return a;
	if (fb === 0) return b;
	while (b - a > tolMs) {
		const m = (a + b) / 2;
		const fm = f(m);
		if (fm === 0) return m;
		if (fa * fm < 0) b = m;
		else {
			a = m;
			fa = fm;
		}
	}
	return (a + b) / 2;
}

export type Phase = 'sunset' | 'sunrise';

/** The window of a JST day in which the sun can set (or rise), as hours from midnight. */
const WINDOW: Record<Phase, [number, number]> = { sunset: [12, 21], sunrise: [3, 12] };

/** The one instant on a day when the sun's azimuth is `bearing`, in the evening (or morning). */
export function timeAtAzimuth(
	day: number,
	lat: number,
	lon: number,
	bearing: number,
	phase: Phase
): number | null {
	const [h0, h1] = WINDOW[phase];
	// After noon the azimuth climbs from ~180 towards 360 without wrapping; before noon it climbs
	// from ~0 to ~180. Both are monotonic, so one sign change is all there is.
	const f = (t: number) => sunPosition(t, lat, lon).azimuth - bearing;
	return solveTime(f, day + h0 * 3_600_000, day + h1 * 3_600_000);
}

/** The instant on a day when the sun's apparent altitude falls (or rises) through `altitude`. */
export function timeAtAltitude(
	day: number,
	lat: number,
	lon: number,
	altitude: number,
	phase: Phase
): number | null {
	const [h0, h1] = WINDOW[phase];
	const f = (t: number) => sunPosition(t, lat, lon).apparent - altitude;
	return solveTime(f, day + h0 * 3_600_000, day + h1 * 3_600_000);
}
