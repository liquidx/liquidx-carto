/**
 * Where exactly to stand: the places on the ground, streets, parks, bridges and viewpoints from
 * OpenStreetMap, that the line of alignment runs through on a given day, each pinned to the
 * spot where it crosses the line.
 */
import { EARTH_RADIUS, distance, type LngLat } from './geo';
import {
	FUJI,
	alignmentOn,
	diamondLocus,
	lineOfSight,
	type Elevation,
	type LocusPoint,
	type Visibility
} from './alignment';
import { SUN_RADIUS, type Phase } from './sun';

const RAD = Math.PI / 180;

/**
 * How the sun's altitude changes with its azimuth as it sets at Fuji's latitude: its path meets
 * the horizon at about 55°, so a degree of azimuth is 1.4° of altitude.
 */
const PATH_SLOPE = 1.4;

/**
 * Half the width of the band, in metres, within which some of the sun's disc touches the summit,
 * at `d` metres from it. Stepping sideways turns the summit's bearing, which the sun reaches at
 * another height; the disc's radius allows this much of that.
 */
export function bandHalfWidth(d: number): number {
	return ((SUN_RADIUS * RAD) / PATH_SLOPE) * d;
}

export type SpotKind = 'park' | 'viewpoint' | 'bridge' | 'beach' | 'street' | 'path';

export interface Spot extends LngLat {
	id: string;
	name: string;
	kind: SpotKind;
	/** Metres from the place searched around. */
	fromCentre: number;
	/** Metres off the exact line. */
	offLine: number;
	/** Metres to the summit. */
	toSummit: number;
	time: number;
	/** The sun's centre above the summit as it crosses the bearing, degrees. */
	offset: number;
	visibility: Visibility;
}

// ── osm ─────────────────────────────────────────────

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

interface OsmElement {
	type: 'node' | 'way' | 'relation';
	id: number;
	tags?: Record<string, string>;
	lat?: number;
	lon?: number;
	geometry?: { lat: number; lon: number }[];
}

const KINDS: { kind: SpotKind; filter: string }[] = [
	{ kind: 'park', filter: '["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"]' },
	{ kind: 'park', filter: '["landuse"="recreation_ground"]' },
	{ kind: 'viewpoint', filter: '["tourism"="viewpoint"]' },
	{ kind: 'beach', filter: '["natural"="beach"]' },
	{ kind: 'bridge', filter: '["man_made"="bridge"]' },
	{ kind: 'bridge', filter: '["bridge"="yes"]["highway"]["name"]' },
	{
		kind: 'street',
		filter:
			'["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"]["name"]'
	},
	{ kind: 'path', filter: '["highway"~"^(footway|cycleway|path|track)$"]["name"]' }
];

/** The Overpass QL for everything of interest within `radius` metres of a polyline. */
export function overpassQuery(line: LngLat[], radius: number): string {
	const coords = line.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
	const around = `(around:${Math.round(radius)},${coords})`;
	const parts = KINDS.map(({ filter }) => `nw${around}${filter};`).join('\n  ');
	return `[out:json][timeout:40];\n(\n  ${parts}\n);\nout tags geom;`;
}

function kindOf(tags: Record<string, string>): SpotKind | null {
	if (tags.tourism === 'viewpoint') return 'viewpoint';
	if (tags.natural === 'beach') return 'beach';
	if (tags.man_made === 'bridge' || (tags.bridge === 'yes' && tags.highway)) return 'bridge';
	if (/^(park|garden|nature_reserve|recreation_ground)$/.test(tags.leisure ?? '')) return 'park';
	if (tags.landuse === 'recreation_ground') return 'park';
	if (/^(footway|cycleway|path|track)$/.test(tags.highway ?? '')) return 'path';
	if (tags.highway) return 'street';
	return null;
}

function nameOf(tags: Record<string, string>, kind: SpotKind): string {
	return (
		tags['name:ja'] ??
		tags.name ??
		tags['name:en'] ??
		{
			park: 'park',
			viewpoint: 'viewpoint',
			bridge: 'bridge',
			beach: 'beach',
			street: 'street',
			path: 'path'
		}[kind]
	);
}

// ── geometry ────────────────────────────────────────

/** Local flat coordinates in metres about an origin. */
function planar(origin: LngLat) {
	const k = RAD * EARTH_RADIUS;
	const c = Math.cos(origin.lat * RAD);
	return {
		to: (p: LngLat) => ({ x: (p.lon - origin.lon) * k * c, y: (p.lat - origin.lat) * k }),
		from: (x: number, y: number): LngLat => ({
			lon: origin.lon + x / (k * c),
			lat: origin.lat + y / k
		})
	};
}

type XY = { x: number; y: number };

/** Closest point on segment ab to p, and the distance to it. */
function toSegment(p: XY, a: XY, b: XY) {
	const dx = b.x - a.x,
		dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
	const q = { x: a.x + t * dx, y: a.y + t * dy };
	return { q, d: Math.hypot(p.x - q.x, p.y - q.y), t };
}

/** Where segments ab and cd cross, if they do. */
function crossing(a: XY, b: XY, c: XY, d: XY): XY | null {
	const r = { x: b.x - a.x, y: b.y - a.y };
	const s = { x: d.x - c.x, y: d.y - c.y };
	const denom = r.x * s.y - r.y * s.x;
	if (Math.abs(denom) < 1e-12) return null;
	const qp = { x: c.x - a.x, y: c.y - a.y };
	const t = (qp.x * s.y - qp.y * s.x) / denom;
	const u = (qp.x * r.y - qp.y * r.x) / denom;
	if (t < 0 || t > 1 || u < 0 || u > 1) return null;
	return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/**
 * The point of a shape (a polyline or a ring) nearest to a polyline, and how far it is: the
 * closest approach of the two, which is a crossing when they cross. Returns the point on the
 * shape, the nearest point on the line and the index of the line segment it is on.
 */
export function closestApproach(shape: XY[], line: XY[]) {
	let best = { d: Infinity, on: shape[0], at: line[0], segment: 0 };
	for (let i = 0; i + 1 < shape.length; i++)
		for (let j = 0; j + 1 < line.length; j++) {
			const x = crossing(shape[i], shape[i + 1], line[j], line[j + 1]);
			if (x) return { d: 0, on: x, at: x, segment: j };
		}
	for (let i = 0; i < shape.length; i++) {
		const p = shape[i];
		for (let j = 0; j + 1 < line.length; j++) {
			const { q, d } = toSegment(p, line[j], line[j + 1]);
			if (d < best.d) best = { d, on: p, at: q, segment: j };
		}
	}
	// And the other way round: a long street segment may pass close between its vertices.
	for (let j = 0; j < line.length; j++) {
		const p = line[j];
		for (let i = 0; i + 1 < shape.length; i++) {
			const { q, d } = toSegment(p, shape[i], shape[i + 1]);
			if (d < best.d) best = { d, on: q, at: p, segment: Math.min(j, line.length - 2) };
		}
	}
	return best;
}

// ── the search ──────────────────────────────────────

export interface FindOptions {
	day: number;
	phase: Phase;
	centre: LngLat;
	/** Metres around the centre to search. */
	radius: number;
	ground: Elevation;
	/** Eye height above the ground at the spots, metres. */
	eye?: number;
	fetch?: typeof globalThis.fetch;
	signal?: AbortSignal;
}

export interface FindResult {
	/** The line of alignment near the centre, about 150 m between points. */
	line: LocusPoint[];
	spots: Spot[];
	/** How many OpenStreetMap features came back before the exact band was applied. */
	candidates: number;
}

/**
 * The line of alignment passes within `radius` of `centre` over some range of distances from
 * the summit; this re-solves it finely over that range.
 */
export function lineNear(
	day: number,
	phase: Phase,
	centre: LngLat,
	radius: number,
	ground: Elevation,
	eye = 1.6
): LocusPoint[] {
	const dc = distance(centre, FUJI);
	const min = Math.max(3_000, dc - radius);
	const max = dc + radius;
	const steps = Math.max(8, Math.ceil((max - min) / 150));
	const pts = diamondLocus(day, phase, ground, eye, { min, max, steps });
	// Distances are solved on a log scale: thin the near end back to about the step wanted.
	return pts.filter((p) => distance(p, centre) <= radius + 500);
}

export async function findSpots({
	day,
	phase,
	centre,
	radius,
	ground,
	eye = 1.6,
	fetch = globalThis.fetch,
	signal
}: FindOptions): Promise<FindResult> {
	const line = lineNear(day, phase, centre, radius, ground, eye);
	if (line.length < 2) return { line, spots: [], candidates: 0 };

	const widest = Math.max(...line.map((p) => bandHalfWidth(p.distance)));
	// Thin the line for the query: Overpass measures to the polyline, so 400 m is plenty.
	const thin = line.filter((_, i) => i % 3 === 0 || i === line.length - 1);
	const body = overpassQuery(thin, widest + 60);
	const res = await fetch(OVERPASS_URL, {
		method: 'POST',
		body: 'data=' + encodeURIComponent(body),
		signal
	});
	if (!res.ok) throw new Error(`overpass: http ${res.status}`);
	const { elements } = (await res.json()) as { elements: OsmElement[] };

	const plane = planar(centre);
	const lineXY = line.map(plane.to);
	const spots: Spot[] = [];
	for (const el of elements) {
		if (!el.tags) continue;
		const kind = kindOf(el.tags);
		if (!kind) continue;
		const shape =
			el.type === 'node' && el.lat !== undefined && el.lon !== undefined
				? [{ lat: el.lat, lon: el.lon }]
				: (el.geometry ?? []);
		if (!shape.length) continue;
		const approach = closestApproach(shape.map(plane.to), lineXY);
		const near = line[approach.segment];
		// Within the band: a park's edge or a street may be off the exact line by this much
		// and still have the sun on the summit.
		if (approach.d > bandHalfWidth(near.distance)) continue;
		const at = plane.from(approach.on.x, approach.on.y);
		const g = ground(at.lon, at.lat);
		const observer = { ...at, elevation: (Number.isFinite(g) ? Math.max(0, g) : 0) + eye };
		const alignment = alignmentOn(observer, day, phase);
		if (!alignment) continue;
		spots.push({
			...at,
			id: `${el.type[0]}${el.id}`,
			name: nameOf(el.tags, kind),
			kind,
			fromCentre: distance(at, centre),
			offLine: approach.d,
			toSummit: distance(at, FUJI),
			time: alignment.time,
			offset: alignment.offset,
			visibility: lineOfSight(observer, ground, 300)
		});
	}
	// One entry per place: the same street comes back as many ways, and a park as a ring and
	// its paths. Keep the nearest to the centre of each name within a short walk.
	spots.sort((a, b) => a.fromCentre - b.fromCentre);
	const kept: Spot[] = [];
	for (const s of spots) {
		if (kept.some((k) => k.name === s.name && k.kind === s.kind && distance(k, s) < 400)) continue;
		kept.push(s);
	}
	return { line, spots: kept, candidates: elements.length };
}
