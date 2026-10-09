/**
 * The resort's features (as exported for the Snow Diorama: OpenStreetMap data via openskidata.org)
 * in the game's local frame: runs, lifts and the named points.
 */
import type { Feature, FeatureCollection, Position } from 'geojson';
import { latToY, lonToX, type MercatorBox } from '$lib/contour/mercator';
import { tileRange } from '$lib/contour/terrain-api';
import { BASE_ZOOM } from './terrain';
import type { LocalFrame } from './frame';

export type Difficulty = 'easy' | 'intermediate' | 'advanced' | 'other';

export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
	easy: '#2f9e44',
	intermediate: '#d6336c',
	advanced: '#212529',
	other: '#868e96'
};

export interface Run {
	id: string;
	name: string;
	difficulty: Difficulty;
	/** World x, z along the run, top to bottom. */
	path: [number, number][];
}

export interface Lift {
	id: string;
	name: string;
	kind: 'gondola' | 'chair';
	seats: number;
	/** Whether its chairs have a bubble hood. */
	bubble: boolean;
	/** World x, z along the line, bottom to top. */
	path: [number, number][];
}

export interface Resort {
	name: string;
	nameJa?: string;
	runs: Run[];
	lifts: Lift[];
	/** World x, z of the base and the peak, where the data has them. */
	base?: [number, number];
	peak?: [number, number];
	peakElevation?: number;
	/** The ski area outline in world x, z. */
	area?: [number, number][];
}

export type FeaturesFile = FeatureCollection & { metadata?: { name?: string; nameJa?: string } };

/**
 * The mercator box of z16 tiles covering every feature, with a margin. Aligning to tiles keeps
 * every terrain cell a whole tile.
 */
export function planArea(features: FeatureCollection, marginMetres = 500): MercatorBox {
	let x0 = Infinity,
		y0 = Infinity,
		x1 = -Infinity,
		y1 = -Infinity;
	let latSum = 0;
	let count = 0;
	const visit = (c: Position | Position[] | Position[][] | Position[][][]) => {
		if (typeof c[0] === 'number') {
			const p = c as Position;
			const x = lonToX(p[0]);
			const y = latToY(p[1]);
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
			latSum += p[1];
			count++;
		} else for (const part of c as Position[]) visit(part);
	};
	for (const f of features.features)
		if (f.geometry && 'coordinates' in f.geometry) visit(f.geometry.coordinates);
	const lat = latSum / count;
	const margin = marginMetres / (40_075_016.686 * Math.cos((lat * Math.PI) / 180));
	const r = tileRange(
		{ x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin },
		BASE_ZOOM
	);
	const n = 2 ** BASE_ZOOM;
	return { x0: r.tx0 / n, y0: r.ty0 / n, x1: (r.tx1 + 1) / n, y1: (r.ty1 + 1) / n };
}

function difficultyOf(f: Feature): Difficulty {
	const d = f.properties?.difficulty;
	return d === 'easy' || d === 'intermediate' || d === 'advanced' ? d : 'other';
}

export function parseResort(features: FeaturesFile, frame: LocalFrame): Resort {
	const runs: Run[] = [];
	const lifts: Lift[] = [];
	const resort: Resort = {
		name: features.metadata?.name ?? 'Ski resort',
		nameJa: features.metadata?.nameJa,
		runs,
		lifts
	};
	for (const f of features.features) {
		const p = f.properties ?? {};
		const g = f.geometry;
		if (!g) continue;
		if (p.kind === 'runSegment' && g.type === 'LineString') {
			runs.push({
				id: p.id,
				name: p.runNameEn ?? p.runName ?? p.nameEn ?? p.name ?? '',
				difficulty: difficultyOf(f),
				path: g.coordinates.map(frame.toWorld)
			});
		} else if (p.kind === 'lift' && g.type === 'LineString') {
			lifts.push({
				id: p.id,
				name: p.nameEn ?? p.name ?? 'Lift',
				kind: p.liftType === 'gondola' ? 'gondola' : 'chair',
				seats: typeof p.occupancy === 'number' ? p.occupancy : 4,
				bubble: p.bubble === true,
				path: g.coordinates.map(frame.toWorld)
			});
		} else if (p.kind === 'locationBase' && g.type === 'Point') {
			resort.base = frame.toWorld(g.coordinates);
		} else if (p.kind === 'locationPeak' && g.type === 'Point') {
			resort.peak = frame.toWorld(g.coordinates);
			resort.peakElevation = p.maxElevation;
		} else if (p.kind === 'skiArea' && g.type === 'Polygon') {
			resort.area = g.coordinates[0].map(frame.toWorld);
		}
	}
	return resort;
}

/** The nearest run to a point and the distance to it, for the HUD and for physics. */
export function nearestRun(
	runs: Run[],
	x: number,
	z: number
): { run: Run; distance: number; t: number; segment: number } | null {
	let best: { run: Run; distance: number; t: number; segment: number } | null = null;
	for (const run of runs) {
		const p = run.path;
		for (let i = 1; i < p.length; i++) {
			const [x0, z0] = p[i - 1];
			const [x1, z1] = p[i];
			const dx = x1 - x0;
			const dz = z1 - z0;
			const t = Math.max(
				0,
				Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1))
			);
			const d = Math.hypot(x - x0 - t * dx, z - z0 - t * dz);
			if (!best || d < best.distance) best = { run, distance: d, t, segment: i };
		}
	}
	return best;
}
