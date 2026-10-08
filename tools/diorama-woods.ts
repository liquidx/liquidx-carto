/**
 * Woodland for a ski diorama, from Overture Maps. Run `pnpm diorama-woods help`.
 *
 * Reads a ski features file, works out the circle its runs and lifts cover (as the
 * /diorama-snow page does), reads the wooded areas there from Overture's land data (OpenStreetMap's
 * woods and forests, republished as Parquet on S3 with no API in the way), and writes them as
 * polygons clipped to that circle's square, next to the features file unless an output path is
 * given.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from 'geojson';
import { circleBounds, fitCircle } from '../src/lib/diorama/fit.ts';

const DEFAULT_FEATURES = join('static', 'diorama', 'appi-kogen-ski-features.geojson');
/** Overture releases are monthly; bump this to pick up newer mapping. */
const OVERTURE_RELEASE = '2026-09-23.1';
const OVERTURE_LAND = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=base/type=land/*`;
/** Corners closer than this to the line between their neighbours are dropped, in metres. */
const SIMPLIFY = 2;

type Ring = Position[];
type Box = [west: number, south: number, east: number, north: number];
type Wood = { osm: string; leafType?: string; rings: Ring[][] };

/**
 * The forest and wood areas touching a box, read straight from Overture's Parquet files: DuckDB
 * fetches only the row groups whose bounds overlap, so this reads a few megabytes of the planet.
 */
async function overture([west, south, east, north]: Box): Promise<Wood[]> {
	const db = await DuckDBInstance.create(':memory:');
	const connection = await db.connect();
	// The extensions are downloaded once and cached under ~/.duckdb.
	await connection.run(
		`INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region = 'us-west-2';`
	);
	const result = await connection.runAndReadAll(
		`SELECT sources[1].record_id AS record, source_tags['leaf_type'] AS leafType,
		        ST_AsGeoJSON(geometry) AS geometry
		 FROM read_parquet('${OVERTURE_LAND}', hive_partitioning = 1)
		 WHERE subtype = 'forest'
		   AND bbox.xmin <= ${east} AND bbox.xmax >= ${west}
		   AND bbox.ymin <= ${north} AND bbox.ymax >= ${south}`
	);
	const osmTypes: Record<string, string> = { n: 'node', w: 'way', r: 'relation' };
	return result.getRowObjects().map((row) => {
		// Overture keeps the OSM id as e.g. "w261303574@2": the element and its version.
		const [, kind, id] = /^([nwr])(\d+)/.exec(String(row.record)) ?? [];
		const geometry = JSON.parse(String(row.geometry)) as Geometry;
		const rings =
			geometry.type === 'Polygon'
				? [geometry.coordinates]
				: geometry.type === 'MultiPolygon'
					? geometry.coordinates
					: [];
		return {
			osm: kind ? `${osmTypes[kind]}/${id}` : String(row.record),
			...(row.leafType ? { leafType: String(row.leafType) } : {}),
			rings
		};
	});
}

/** Where the woods go when no output path is given: beside the features file. */
const woodsPathFor = (source: string) =>
	source.replace(/(-ski-features)?\.geojson$/, '-woods.geojson');

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

async function build(source: string, target = woodsPathFor(source)) {
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

	console.log(`overture ${OVERTURE_RELEASE}`);
	const areas = await overture(box);

	const perLat = 111_320;
	const perLon = perLat * Math.cos((circle.lat * Math.PI) / 180);
	const tidy = (ring: Ring) =>
		simplify(clip(ring, box), perLon, perLat).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]);
	const woods: Feature<Polygon>[] = [];
	for (const area of areas) {
		for (const [outer, ...holes] of area.rings) {
			const ring = tidy(outer);
			if (!ring.length) continue;
			woods.push({
				type: 'Feature',
				properties: {
					kind: 'wood',
					id: `osm:${area.osm}`,
					...(area.leafType ? { leafType: area.leafType } : {})
				},
				geometry: {
					type: 'Polygon',
					coordinates: [ring, ...holes.map(tidy).filter((hole) => hole.length)]
				}
			});
		}
	}

	const text = JSON.stringify({
		type: 'FeatureCollection',
		metadata: {
			source: `overture maps ${OVERTURE_RELEASE} base/land subtype=forest, from openstreetmap`,
			exportedAt: new Date().toISOString(),
			bounds: box.map((v) => +v.toFixed(6)),
			featureCount: woods.length
		},
		features: woods
	});
	await writeFile(target, text);
	const corners = woods.reduce((n, f) => n + f.geometry.coordinates.flat().length, 0);
	console.log(`  ${areas.length} areas → ${woods.length} polygons, ${corners} corners`);
	console.log(`  ${target}  ${(Buffer.byteLength(text) / 1024).toFixed(0)} kB`);
}

const [command = 'help', source = DEFAULT_FEATURES, target] = process.argv.slice(2);

if (command === 'build') {
	await build(source, target);
} else {
	console.log(`usage: pnpm diorama-woods build [features.geojson] [woods.geojson]

  build   fetch the wooded areas around the runs and lifts in a ski features file
          (default ${DEFAULT_FEATURES}) and write them to the output
          path, or beside the features file as <name>-woods.geojson when none is given`);
}
