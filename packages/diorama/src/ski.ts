/**
 * How a ski resort's runs and lifts are drawn, for `SkiRuns` and `SkiLifts`. Features are
 * read as OpenSkiData has them, the way snowline serves them: a run is `kind: 'runSegment'`
 * with a `difficulty`, a lift is `kind: 'lift'` with a `liftType`, `occupancy`, `bubble`,
 * `status`, and its `lengthMeters` and `durationSecs` where known. Everything here is a
 * default that the components' props can override.
 */
import type { Feature } from 'geojson';

export type Difficulty = 'easy' | 'intermediate' | 'advanced' | 'other';

/** The colour of a run by its difficulty, with `other` for one that has none of these. */
export const RUN_COLORS: Record<Difficulty, string> = {
	easy: '#2f9e44',
	intermediate: '#d6336c',
	advanced: '#212529',
	other: '#868e96'
};

export const isRun = (f: Feature) => f.properties?.kind === 'runSegment';
export const isLift = (f: Feature) => f.properties?.kind === 'lift';

export function difficultyOf(f: Feature): Difficulty {
	const d = f.properties?.difficulty;
	return d === 'easy' || d === 'intermediate' || d === 'advanced' ? d : 'other';
}

/** Whether a feature is an area rather than a line. */
export const isArea = (f: Feature) =>
	f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon';

/** `hex` (#rrggbb) mixed `amount` of the way to white, at `alpha` opacity, as a CSS colour. */
export function paler(hex: string, amount: number, alpha = 1) {
	const mixed = [1, 3, 5].map((at) => {
		const channel = parseInt(hex.slice(at, at + 2), 16);
		return Math.round(channel + (255 - channel) * amount);
	});
	return `rgb(${mixed.join(' ')} / ${alpha})`;
}

/**
 * The kinds of lift, from `liftType`. A cable car is an aerial tramway, two big cabins that
 * shuttle up and down; a rope tow is a rope at arm's height with no stations; a magic carpet
 * is a belt on the snow. Anything else is a chair lift.
 */
export type LiftKind = 'chair' | 'gondola' | 'cableCar' | 'ropeTow' | 'carpet';

export function liftKind(f: Feature): LiftKind {
	switch (f.properties?.liftType) {
		case 'gondola':
			return 'gondola';
		case 'cable_car':
			return 'cableCar';
		case 'rope_tow':
			return 'ropeTow';
		case 'magic_carpet':
			return 'carpet';
		default:
			return 'chair';
	}
}

/** How many a chair or cabin seats, 2 when the data does not say. */
export const seats = (f: Feature): number => f.properties?.occupancy ?? 2;

/** A lift that no longer runs: its towers and cable stand, with nothing on them. */
export const isOutOfService = (f: Feature) =>
	f.properties?.status === 'disused' || f.properties?.status === 'abandoned';

/**
 * Sizes and speeds of each kind of lift, in metres and metres a second.
 *
 * - `height`: the cable above the ground at the towers. A chair hangs 3.3 m below its cable,
 *   so a chair lift's is high enough to keep a rider's boots well off the snow.
 * - `clearance`: the least the cable is above the ground anywhere; the towers stand taller
 *   where the ground bulges up under a span.
 * - `speed`: how fast it runs when the data has no ride time. A fixed-grip double is slow and
 *   a detachable quad fast, so a chair lift's depends on its seats: see `liftSpeed`.
 * - `every`: metres between carriers, or for a chair lift `interval`, the seconds between
 *   chairs arriving at a station, which spaces them by their speed.
 */
export const LIFT_METRICS = {
	chair: { height: 8, clearance: 6, speed: 2, quadSpeed: 4, interval: 10 },
	gondola: { height: 14, clearance: 0, speed: 5, every: 45 },
	cableCar: { height: 20, clearance: 0, speed: 8 },
	ropeTow: { height: 1.1, clearance: 0, speed: 2, every: 12 },
	carpet: { speed: 0.7 }
};

/** Metres a second: from the ride time where the lift has one, else typical for its kind. */
export function liftSpeed(f: Feature) {
	if (isOutOfService(f)) return 0;
	const { lengthMeters, durationSecs } = f.properties ?? {};
	if (lengthMeters && durationSecs) return lengthMeters / durationSecs;
	const kind = liftKind(f);
	if (kind === 'chair' && seats(f) >= 4) return LIFT_METRICS.chair.quadSpeed;
	return LIFT_METRICS[kind].speed;
}

/** Metres between carriers, 0 for a lift that no longer runs. */
export function carrierSpacing(f: Feature) {
	if (isOutOfService(f)) return 0;
	const kind = liftKind(f);
	if (kind === 'chair') return liftSpeed(f) * LIFT_METRICS.chair.interval;
	if (kind === 'gondola' || kind === 'ropeTow') return LIFT_METRICS[kind].every;
	// A cable car shuttles its two cabins whatever the spacing.
	return 1;
}

/** Width of a carrier in metres: a seat's worth each for a chair, a cabin by how many it holds. */
export function carrierWidth(f: Feature) {
	const n = seats(f);
	switch (liftKind(f)) {
		case 'cableCar':
			return 2.8;
		case 'ropeTow':
			return 0.3;
		case 'gondola':
			return n >= 8 ? 2.4 : n >= 6 ? 2.1 : 1.8;
		default:
			return n * 0.55 + 0.2;
	}
}

/** The lift models that come with the package, as URLs. */
export const LIFT_MODELS = {
	/** Chairs by how many they seat. */
	chairs: {
		1: new URL('./models/chairlift-1.glb', import.meta.url).href,
		2: new URL('./models/chairlift-2.glb', import.meta.url).href,
		3: new URL('./models/chairlift-3.glb', import.meta.url).href,
		4: new URL('./models/chairlift-4.glb', import.meta.url).href
	} as Record<number, string>,
	gondola: new URL('./models/gondola.glb', import.meta.url).href,
	cableCar: new URL('./models/ropeway.glb', import.meta.url).href,
	station: new URL('./models/lift-station.glb', import.meta.url).href
};
