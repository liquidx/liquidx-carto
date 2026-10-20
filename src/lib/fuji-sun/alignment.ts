/**
 * Diamond Fuji (ダイヤモンド富士): the sun setting, or rising, exactly on the summit of Mount
 * Fuji. Given somewhere to stand, this works out which days of the year it happens and when;
 * given a day, where to stand.
 */
import { angleDiff, apparentElevation, bearing, destination, distance, type LngLat } from './geo';
import {
	SUN_RADIUS,
	daysInYear,
	jstDay,
	sunPosition,
	timeAtAltitude,
	timeAtAzimuth,
	type Phase
} from './sun';

/** Kengamine (剣ヶ峰), the highest point on the crater rim. */
export const FUJI = { lon: 138.72745, lat: 35.36077, elevation: 3776 };

export interface Observer extends LngLat {
	/** Height of the eye above sea level, in metres. */
	elevation: number;
}

/** An elevation sampler: metres above sea level, or NaN where there is no data. */
export type Elevation = (lon: number, lat: number) => number;

export interface Sightline {
	/** Metres to the summit. */
	distance: number;
	/** Compass bearing of the summit from the observer. */
	bearing: number;
	/** How high the summit appears above the observer's horizontal, in degrees. */
	summitAngle: number;
}

export function sightline(observer: Observer): Sightline {
	const d = distance(observer, FUJI);
	return {
		distance: d,
		bearing: bearing(observer, FUJI),
		summitAngle: apparentElevation(d, FUJI.elevation - observer.elevation)
	};
}

// ── when ────────────────────────────────────────────

export interface AlignmentDay {
	/** Midnight JST on the day. */
	day: number;
	/** The instant the sun's centre is on the summit's bearing. */
	time: number;
	/** Where the centre of the sun is then, in degrees above the summit (negative: below). */
	offset: number;
}

/**
 * The sun's offset from the summit at the moment it crosses the summit's bearing, on every day
 * of a year. Days the sun never reaches that bearing while setting (or rising) are left out.
 */
export function alignmentDays(observer: Observer, year: number, phase: Phase): AlignmentDay[] {
	const { bearing: brg, summitAngle } = sightline(observer);
	const out: AlignmentDay[] = [];
	for (let doy = 1; doy <= daysInYear(year); doy++) {
		const day = jstDay(year, doy);
		const time = timeAtAzimuth(day, observer.lat, observer.lon, brg, phase);
		if (time === null) continue;
		const offset = sunPosition(time, observer.lat, observer.lon).apparent - summitAngle;
		out.push({ day, time, offset });
	}
	return out;
}

export interface DiamondWindow {
	/** Consecutive days on which some of the sun's disc touches the summit, best day first. */
	days: AlignmentDay[];
	best: AlignmentDay;
}

/**
 * The runs of days when the sun's disc overlaps the summit. Usually two a year: once as the
 * sunset point moves south in autumn and once as it comes back north in late winter, or the
 * other way round for somewhere the sunset azimuth of Fuji is north of west.
 */
export function diamondWindows(days: AlignmentDay[]): DiamondWindow[] {
	const windows: DiamondWindow[] = [];
	let run: AlignmentDay[] = [];
	const flush = () => {
		if (!run.length) return;
		const best = run.reduce((a, b) => (Math.abs(b.offset) < Math.abs(a.offset) ? b : a));
		windows.push({ days: run, best });
		run = [];
	};
	for (const d of days) {
		const touching = Math.abs(d.offset) <= SUN_RADIUS;
		const last = run.at(-1);
		if (touching && (!last || d.day - last.day <= 86_400_000)) run.push(d);
		else {
			flush();
			if (touching) run.push(d);
		}
	}
	flush();
	return windows;
}

/** The alignment on the day of `time`, if the sun crosses the bearing that day. */
export function alignmentOn(observer: Observer, day: number, phase: Phase): AlignmentDay | null {
	const { bearing: brg, summitAngle } = sightline(observer);
	const time = timeAtAzimuth(day, observer.lat, observer.lon, brg, phase);
	if (time === null) return null;
	return {
		day,
		time,
		offset: sunPosition(time, observer.lat, observer.lon).apparent - summitAngle
	};
}

// ── where ───────────────────────────────────────────

export interface LocusPoint extends LngLat {
	/** Metres from the summit. */
	distance: number;
	/** Ground elevation used for the eye, in metres. */
	elevation: number;
	/** When the sun sits on the summit from here, JST epoch ms. */
	time: number;
}

/**
 * Where to stand on a given day: for each distance from the summit, the one spot from which the
 * centre of the setting (or rising) sun passes over the summit. The spots trace a line running
 * away from the mountain, roughly opposite the sun. `ground` gives the terrain under each spot;
 * `eye` is added to it.
 */
export function diamondLocus(
	day: number,
	phase: Phase,
	ground: Elevation,
	eye = 1.6,
	{ min = 5_000, max = 250_000, steps = 70 }: { min?: number; max?: number; steps?: number } = {}
): LocusPoint[] {
	const out: LocusPoint[] = [];
	// First guess: the bearing of the sun from Fuji itself when it is a summit's height above
	// the horizon at a typical distance, turned around.
	let theta: number | null = null;
	for (let i = 0; i <= steps; i++) {
		const d = min * (max / min) ** (i / steps);
		if (theta === null) {
			const t0 = timeAtAltitude(day, FUJI.lat, FUJI.lon, 2, phase);
			if (t0 === null) return out;
			theta = (sunPosition(t0, FUJI.lat, FUJI.lon).azimuth + 180) % 360;
		}
		let p: LngLat = destination(FUJI, theta, d);
		let elevation = 0;
		let time: number | null = null;
		let converged = false;
		for (let k = 0; k < 8; k++) {
			const g = ground(p.lon, p.lat);
			elevation = (Number.isFinite(g) ? Math.max(0, g) : 0) + eye;
			const summitAngle = apparentElevation(d, FUJI.elevation - elevation);
			time = timeAtAltitude(day, p.lat, p.lon, summitAngle, phase);
			if (time === null) break;
			const az = sunPosition(time, p.lat, p.lon).azimuth;
			const err = angleDiff(bearing(p, FUJI), az);
			theta = (theta + err + 360) % 360;
			p = destination(FUJI, theta, d);
			if (Math.abs(err) < 0.002) {
				converged = true;
				break;
			}
		}
		if (!converged || time === null) continue;
		out.push({ ...p, distance: d, elevation, time });
	}
	return out;
}

// ── the view ────────────────────────────────────────

export interface Skyline {
	/** Azimuth of the first bin. */
	start: number;
	/** Degrees per bin. */
	step: number;
	/** The highest apparent elevation of terrain in each azimuth bin. */
	angles: Float32Array;
	/** The distance, in metres, of whatever is highest in each bin. */
	distances: Float32Array;
}

export interface TerrainGrid {
	west: number;
	south: number;
	east: number;
	north: number;
	width: number;
	height: number;
	/** Row-major, northern row first. */
	data: Float32Array;
}

/**
 * The horizon as seen from the observer across a span of azimuths: for every terrain sample in
 * the grids, the bearing and apparent elevation from the observer, keeping the highest per bin.
 * Grids are consulted in order, and later grids skip samples the earlier ones cover.
 */
export function skyline(
	observer: Observer,
	grids: TerrainGrid[],
	centre: number,
	halfSpan: number,
	step = 0.02
): Skyline {
	const n = Math.ceil((halfSpan * 2) / step) + 1;
	const start = centre - halfSpan;
	const angles = new Float32Array(n).fill(-90);
	const distances = new Float32Array(n);
	const cosLat = Math.cos(observer.lat * (Math.PI / 180));
	const mPerDegLat = (Math.PI / 180) * 6_371_008.8;
	const covered: TerrainGrid[] = [];
	for (const g of grids) {
		const dLon = (g.east - g.west) / (g.width - 1);
		const dLat = (g.north - g.south) / (g.height - 1);
		// A sample stands for a cell this wide; from the observer it covers an angle that shrinks
		// with distance, and it is drawn across every bin that angle touches so nearby bins never
		// fall between samples.
		const cell = dLat * mPerDegLat * 0.75;
		for (let j = 0; j < g.height; j++) {
			const lat = g.north - j * dLat;
			const dy = (lat - observer.lat) * mPerDegLat;
			for (let i = 0; i < g.width; i++) {
				const z = g.data[j * g.width + i];
				if (Number.isNaN(z)) continue;
				const lon = g.west + i * dLon;
				if (covered.some((c) => lon >= c.west && lon <= c.east && lat >= c.south && lat <= c.north))
					continue;
				// Flat-earth bearing and distance are plenty for binning at these ranges.
				const dx = (lon - observer.lon) * mPerDegLat * cosLat;
				const d = Math.hypot(dx, dy);
				if (d < 50) continue;
				const az = (Math.atan2(dx, dy) * (180 / Math.PI) + 360) % 360;
				const rel = angleDiff(start, az);
				const footprint = Math.atan2(cell, d) * (180 / Math.PI);
				if (rel + footprint < 0 || rel - footprint > halfSpan * 2) continue;
				const a = apparentElevation(d, z - observer.elevation);
				const b0 = Math.max(0, Math.round((rel - footprint) / step));
				const b1 = Math.min(n - 1, Math.round((rel + footprint) / step));
				for (let bin = b0; bin <= b1; bin++) {
					if (a > angles[bin]) {
						angles[bin] = a;
						distances[bin] = d;
					}
				}
			}
		}
		covered.push(g);
	}
	return { start, step, angles, distances };
}

export interface Visibility {
	visible: boolean;
	/** When blocked, how far away the terrain in the way is, in metres, and how high it is. */
	blockedAt?: { distance: number; elevation: number; angle: number };
}

/**
 * Whether the summit can be seen at all, by walking the line of sight and asking if any ground
 * along it stands higher than the summit does.
 */
export function lineOfSight(observer: Observer, ground: Elevation, samples = 600): Visibility {
	const { distance: total, bearing: brg, summitAngle } = sightline(observer);
	let worst: Visibility['blockedAt'];
	for (let i = 1; i < samples; i++) {
		const d = (total * i) / samples;
		// The summit itself and its cone: stop short of the last kilometre.
		if (d > total - 1_000) break;
		const p = destination(observer, brg, d);
		const z = ground(p.lon, p.lat);
		if (!Number.isFinite(z)) continue;
		const a = apparentElevation(d, z - observer.elevation);
		if (a > summitAngle && (!worst || a > worst.angle))
			worst = { distance: d, elevation: z, angle: a };
	}
	return worst ? { visible: false, blockedAt: worst } : { visible: true };
}
