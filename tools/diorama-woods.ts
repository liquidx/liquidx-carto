/**
 * Woodland for a ski diorama, from OpenStreetMap. Run `pnpm diorama-woods help`.
 *
 * Reads a ski features file, works out the circle its runs and lifts cover (as the
 * /diorama-snow page does), asks the Overpass API for the wooded areas there, and writes them
 * as polygons clipped to that circle's square, next to the features file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';
import { circleBounds, fitCircle } from '../src/lib/diorama/fit.ts';

const DEFAULT_FEATURES = join('static', 'diorama', 'appi-kogen-ski-features.geojson');
/** Public Overpass servers, tried in turn. */
const OVERPASS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter'
];
/** Corners closer than this to the line between their neighbours are dropped, in metres. */
const SIMPLIFY = 2;

type Point = { lat: number; lon: number };
type Member = { type: string; role: string; geometry?: Point[] };
type Element = {
	type: 'way' | 'relation';
	id: number;
	tags?: Record<string, string>;
	geometry?: Point[];
	members?: Member[];
};
type Ring = Position[];
type Box = [west: number, south: number, east: number, north: number];

async function overpass(query: string): Promise<Element[]> {
	let failure: unknown;
	for (const url of OVERPASS) {
		try {
			const response = await fetch(url, {
				method: 'POST',
				// Overpass turns away requests that do not say who they are.
				headers: { 'User-Agent': 'liquidx-carto diorama-woods' },
				body: new URLSearchParams({ data: query })
			});
			if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
			return ((await response.json()) as { elements: Element[] }).elements;
		} catch (e) {
			failure = e;
			console.log(`  ${new URL(url).host}: ${e instanceof Error ? e.message : e}`);
		}
	}
	throw failure;
}

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** Join ways end to end into closed rings; ways that never close are left out. */
function assemble(ways: Ring[]): Ring[] {
	const rings: Ring[] = [];
	const open = ways.filter((w) => w.length > 1).map((w) => [...w]);
	while (open.length) {
		const ring = open.pop()!;
		while (!same(ring[0], ring[ring.length - 1])) {
			const end = ring[ring.length - 1];
			const next = open.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
			if (next < 0) break;
			const [way] = open.splice(next, 1);
			if (!same(way[0], end)) way.reverse();
			ring.push(...way.slice(1));
		}
		if (ring.length > 3 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
	}
	return rings;
}

function inside([x, y]: Position, ring: Ring) {
	let hit = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
	}
	return hit;
}

/** Each outer ring with the holes that lie in it. */
function polygonsOf(element: Element): Ring[][] {
	const path = (points: Point[] = []) => points.map((p): Position => [p.lon, p.lat]);
	if (element.type === 'way') return assemble([path(element.geometry)]).map((ring) => [ring]);
	const ways = (role: string) =>
		(element.members ?? [])
			.filter((m) => m.type === 'way' && (m.role || 'outer') === role)
			.map((m) => path(m.geometry));
	const polygons = assemble(ways('outer')).map((ring) => [ring]);
	for (const hole of assemble(ways('inner')))
		polygons.find(([outer]) => inside(hole[0], outer))?.push(hole);
	return polygons;
}

/** Cut a closed ring down to a box, one edge of the box at a time. */
function clip(ring: Ring, [west, south, east, north]: Box): Ring {
	const edges: [axis: 0 | 1, limit: number, keepAbove: boolean][] = [
		[0, west, true],
		[0, east, false],
		[1, south, true],
		[1, north, false]
	];
	let points = ring.slice(0, -1);
	for (const [axis, limit, keepAbove] of edges) {
		const kept = (p: Position) => (keepAbove ? p[axis] >= limit : p[axis] <= limit);
		const out: Ring = [];
		points.forEach((p, i) => {
			const q = points[(i + 1) % points.length];
			if (kept(p)) out.push(p);
			if (kept(p) !== kept(q)) {
				const t = (limit - p[axis]) / (q[axis] - p[axis]);
				out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
			}
		});
		points = out;
	}
	return points.length > 2 ? [...points, points[0]] : [];
}

/** Drop the corners of a closed ring that hardly bend it (Douglas-Peucker). */
function simplify(ring: Ring, perLon: number, perLat: number): Ring {
	if (!ring.length) return ring;
	const keep = new Uint8Array(ring.length);
	keep[0] = keep[ring.length - 1] = 1;
	const stack: [number, number][] = [[0, ring.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		const ax = ring[a][0] * perLon;
		const ay = ring[a][1] * perLat;
		const dx = ring[b][0] * perLon - ax;
		const dy = ring[b][1] * perLat - ay;
		const length = Math.hypot(dx, dy);
		let far = -1;
		let most = SIMPLIFY;
		for (let i = a + 1; i < b; i++) {
			const px = ring[i][0] * perLon - ax;
			const py = ring[i][1] * perLat - ay;
			const off = length ? Math.abs(px * dy - py * dx) / length : Math.hypot(px, py);
			if (off > most) {
				most = off;
				far = i;
			}
		}
		if (far < 0) continue;
		keep[far] = 1;
		stack.push([a, far], [far, b]);
	}
	const out = ring.filter((_, i) => keep[i]);
	return out.length > 3 ? out : [];
}

async function build(source: string) {
	const features = JSON.parse(await readFile(source, 'utf8')) as FeatureCollection;
	// The same circle as the page: around the runs and lifts.
	const points = features.features
		.filter((f) => ['runSegment', 'lift'].includes(f.properties?.kind))
		.flatMap((f) => {
			const g = f.geometry;
			if (g.type === 'LineString') return g.coordinates;
			if (g.type === 'MultiLineString' || g.type === 'Polygon') return g.coordinates.flat();
			return [];
		});
	if (!points.length) throw new Error(`no runs or lifts in ${source}`);
	const circle = fitCircle(points);
	const box = circleBounds(circle);
	const [west, south, east, north] = box;

	console.log('openstreetmap');
	const area = `(${south},${west},${north},${east})`;
	const elements = await overpass(
		`[out:json][timeout:90];(` +
			['way', 'relation']
				.flatMap((type) => [
					`${type}["natural"="wood"]${area};`,
					`${type}["landuse"="forest"]${area};`
				])
				.join('') +
			`);out geom;`
	);

	const perLat = 111_320;
	const perLon = perLat * Math.cos((circle.lat * Math.PI) / 180);
	const tidy = (ring: Ring) =>
		simplify(clip(ring, box), perLon, perLat).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]);
	const woods: Feature<Polygon>[] = [];
	for (const element of elements) {
		for (const [outer, ...holes] of polygonsOf(element)) {
			const ring = tidy(outer);
			if (!ring.length) continue;
			const leafType = element.tags?.leaf_type;
			woods.push({
				type: 'Feature',
				properties: {
					kind: 'wood',
					id: `osm:${element.type}/${element.id}`,
					...(leafType ? { leafType } : {})
				},
				geometry: {
					type: 'Polygon',
					coordinates: [ring, ...holes.map(tidy).filter((hole) => hole.length)]
				}
			});
		}
	}

	const target = source.replace(/(-ski-features)?\.geojson$/, '-woods.geojson');
	const text = JSON.stringify({
		type: 'FeatureCollection',
		metadata: {
			source: 'openstreetmap (natural=wood, landuse=forest) via overpass',
			exportedAt: new Date().toISOString(),
			bounds: box.map((v) => +v.toFixed(6)),
			featureCount: woods.length
		},
		features: woods
	});
	await writeFile(target, text);
	const corners = woods.reduce((n, f) => n + f.geometry.coordinates.flat().length, 0);
	console.log(`  ${elements.length} areas → ${woods.length} polygons, ${corners} corners`);
	console.log(`  ${target}  ${(Buffer.byteLength(text) / 1024).toFixed(0)} kB`);
}

const [command = 'help', source = DEFAULT_FEATURES] = process.argv.slice(2);

if (command === 'build') {
	await build(source);
} else {
	console.log(`usage: pnpm diorama-woods build [features.geojson]

  build   fetch the wooded areas around the runs and lifts in a ski features file
          (default ${DEFAULT_FEATURES}) and write them beside it as
          <name>-woods.geojson`);
}
