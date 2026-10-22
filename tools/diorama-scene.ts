/**
 * Scene features for a ski diorama, from Overture Maps. Run `pnpm diorama-scene help`.
 *
 * Reads a ski features file, works out the circle its runs, lifts and resort area cover (as the
 * /diorama-snow page does), and reads what OpenStreetMap maps there from Overture's Parquet
 * files on S3 (no API in the way): woods, water and waterways, buildings, roads and car parks.
 * They are written as one GeoJSON file, each feature with a `kind`, clipped to that circle's
 * square, next to the features file unless an output path is given.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { circleBounds, fitCircle, fitPoints } from '../src/lib/diorama/fit.ts';

const DEFAULT_FEATURES = join('static', 'diorama', 'appi-kogen-ski-features.geojson');
/** Overture releases are monthly; bump this to pick up newer mapping. */
const OVERTURE_RELEASE = '2026-09-23.1';
const overture = (theme: string, type: string) =>
	`read_parquet('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=${theme}/type=${type}/*', hive_partitioning = 1)`;
/** Corners closer than this to the line between their neighbours are dropped, in metres. */
const SIMPLIFY = 2;
/**
 * The widest circle a resort can plausibly fit (the largest, Shiga Kogen, is 8.4 km). A wider
 * one means the features file mixes two resorts of the same name, far apart: reading all the
 * buildings between them runs out of memory, or writes a scene of hundreds of megabytes.
 */
const MAX_RADIUS = 15_000;
/**
 * Overture road classes that are paths rather than roads: footways, trails, stairs, cycle
 * tracks and the like. Everything else under `subtype = 'road'` is kept, tracks included.
 */
const PATH_CLASSES = [
	'footway',
	'path',
	'steps',
	'cycleway',
	'bridleway',
	'sidewalk',
	'crosswalk',
	'pedestrian'
];

type Path = Position[];
type Box = [west: number, south: number, east: number, north: number];

/** What the scene file holds, by the `kind` of each feature. */
export type SceneKind = 'wood' | 'water' | 'waterway' | 'building' | 'road' | 'carpark';

/** One row read from Overture, before clipping: an id, its tags and its geometry. */
interface Row {
	id: string;
	geometry: Geometry;
	props: Record<string, unknown>;
}

/** A layer of the scene: which Overture rows to read and the properties to keep from them. */
interface Layer {
	/** The `kind` for polygons, or for points and lines when the layer has one kind. */
	kind: SceneKind;
	/** The `kind` for lines; a layer without one keeps only polygons. */
	lineKind?: SceneKind;
	/** The SQL for the rows: `$box` stands for the bounds condition, `$envelope` for their shape. */
	sql: string;
	/** Which simplification to apply; buildings keep every corner. */
	simplify: boolean;
}

/**
 * The row's bounding box overlapping the scene's, which prunes the Parquet row groups, and
 * then the geometry really crossing it: an ocean tile's box can reach far inland.
 */
const bboxWhere = ([west, south, east, north]: Box) =>
	`bbox.xmin <= ${east} AND bbox.xmax >= ${west} AND bbox.ymin <= ${north} AND bbox.ymax >= ${south}
	   AND ST_Intersects(geometry, ${envelope([west, south, east, north])})`;
const envelope = ([west, south, east, north]: Box) =>
	`ST_MakeEnvelope(${west}, ${south}, ${east}, ${north})`;
/** The part of the geometry inside the scene, as GeoJSON. */
const CLIPPED = 'ST_AsGeoJSON(ST_Intersection(geometry, $envelope)) AS geometry';

const LAYERS: Record<string, Layer> = {
	woods: {
		kind: 'wood',
		simplify: true,
		sql: `SELECT id, sources[1].record_id AS record, ${CLIPPED},
		             source_tags['leaf_type'] AS leafType
		      FROM ${overture('base', 'land')} WHERE subtype = 'forest' AND $box`
	},
	water: {
		kind: 'water',
		lineKind: 'waterway',
		simplify: true,
		sql: `SELECT id, sources[1].record_id AS record, ${CLIPPED},
		             subtype AS waterType, names."primary" AS name, is_intermittent AS intermittent
		      FROM ${overture('base', 'water')} WHERE $box`
	},
	buildings: {
		kind: 'building',
		simplify: false,
		sql: `SELECT id, sources[1].record_id AS record, ${CLIPPED},
		             height, num_floors AS levels, coalesce(class, subtype) AS buildingType,
		             names."primary" AS name
		      FROM ${overture('buildings', 'building')} WHERE $box`
	},
	roads: {
		kind: 'road',
		lineKind: 'road',
		simplify: true,
		sql: `SELECT id, sources[1].record_id AS record, ${CLIPPED},
		             class AS roadClass, names."primary" AS name
		      FROM ${overture('transportation', 'segment')}
		      WHERE subtype = 'road' AND class NOT IN (${PATH_CLASSES.map((c) => `'${c}'`).join(', ')})
		        AND $box`
	},
	carparks: {
		kind: 'carpark',
		simplify: true,
		sql: `SELECT id, sources[1].record_id AS record, ${CLIPPED},
		             names."primary" AS name
		      FROM ${overture('base', 'infrastructure')}
		      WHERE subtype = 'transit' AND class = 'parking' AND $box`
	}
};

const OSM_TYPES: Record<string, string> = { n: 'node', w: 'way', r: 'relation' };

/**
 * The rows of a layer touching a box, read straight from Overture's Parquet files: DuckDB
 * fetches only the row groups whose bounds overlap, so each layer reads a few megabytes of the
 * planet.
 */
async function read(connection: DuckDBConnection, layer: Layer, box: Box): Promise<Row[]> {
	const result = await connection.runAndReadAll(
		layer.sql.replace('$box', bboxWhere(box)).replace('$envelope', envelope(box))
	);
	return result.getRowObjects().map(({ id, record, geometry, ...rest }) => {
		// Overture keeps the OSM id as e.g. "w261303574@2": the element and its version. Rows
		// from other sources (some building footprints) only have their Overture id.
		const [, kind, number] = /^([nwr])(\d+)/.exec(String(record ?? '')) ?? [];
		const props: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(rest)) {
			if (value === null || value === undefined || value === false) continue;
			props[key] = typeof value === 'bigint' ? Number(value) : value;
		}
		return {
			id: kind ? `osm:${OSM_TYPES[kind]}/${number}` : `overture:${id}`,
			geometry: JSON.parse(String(geometry)) as Geometry,
			props
		};
	});
}

/** Where the scene goes when no output path is given: beside the features file. */
const scenePathFor = (source: string) =>
	source.replace(/(-ski-features)?\.geojson$/, '-scene.geojson');

/** The rings and lines of a geometry, whatever it is made of. */
function parts(geometry: Geometry, out = { rings: [] as Path[][], lines: [] as Path[] }) {
	switch (geometry.type) {
		case 'Polygon':
			out.rings.push(geometry.coordinates);
			break;
		case 'MultiPolygon':
			out.rings.push(...geometry.coordinates);
			break;
		case 'LineString':
			out.lines.push(geometry.coordinates);
			break;
		case 'MultiLineString':
			out.lines.push(...geometry.coordinates);
			break;
		case 'GeometryCollection':
			for (const g of geometry.geometries) parts(g, out);
			break;
	}
	return out;
}

/**
 * Drop the corners of a path that hardly bend it (Douglas–Peucker). A closed path (a ring)
 * must keep at least three distinct corners, an open one at least its two ends.
 */
function simplify(path: Path, perLon: number, perLat: number, closed: boolean): Path {
	if (!path.length) return path;
	const keep = new Uint8Array(path.length);
	keep[0] = keep[path.length - 1] = 1;
	const stack: [number, number][] = [[0, path.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		const ax = path[a][0] * perLon;
		const ay = path[a][1] * perLat;
		const dx = path[b][0] * perLon - ax;
		const dy = path[b][1] * perLat - ay;
		const length = Math.hypot(dx, dy);
		let far = -1;
		let most = SIMPLIFY;
		for (let i = a + 1; i < b; i++) {
			const px = path[i][0] * perLon - ax;
			const py = path[i][1] * perLat - ay;
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
	const out = path.filter((_, i) => keep[i]);
	return out.length > (closed ? 3 : 1) ? out : [];
}

/**
 * One DuckDB for the whole run. Nearly all of a query's time goes on reading the footers of
 * Overture's Parquet files (500-odd for buildings, over a minute from S3), not on the rows: with
 * the object cache on, the footers are read once per process and every later query against
 * the same files takes a second or two. So many resorts should share one instance.
 */
async function openOverture() {
	console.log(`overture ${OVERTURE_RELEASE}`);
	const db = await DuckDBInstance.create(':memory:');
	const setup = await db.connect();
	// The extensions are downloaded once and cached under ~/.duckdb.
	await setup.run(
		`INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;
		 SET GLOBAL s3_region = 'us-west-2'; SET GLOBAL enable_object_cache = true;`
	);
	setup.closeSync();
	return db;
}

/** The box the scene of a features file covers, or why it has none. */
async function sceneBox(source: string): Promise<Box | string> {
	const features = JSON.parse(await readFile(source, 'utf8')) as FeatureCollection;
	const points = fitPoints(features);
	// Nothing to fit a circle around, so no square to read: leave the file without a scene.
	if (!points.length) return 'no runs, lifts or resort area';
	// The same circle as the page: around the runs, lifts and resort area.
	const circle = fitCircle(points);
	// A resort known only as a single point fits a circle of no size: nothing to read either.
	if (!circle.radius) return 'only a point for the resort';
	if (circle.radius > MAX_RADIUS)
		return `a circle of ${(circle.radius / 1000).toFixed(0)} km around the runs and lifts, the file likely mixes two resorts`;
	return circleBounds(circle);
}

/** Build the scene of one features file; the reason when it has none. */
async function build(
	db: DuckDBInstance,
	source: string,
	target = scenePathFor(source)
): Promise<string | undefined> {
	const box = await sceneBox(source);
	if (typeof box === 'string') {
		console.log(`${source}: ${box}, skipping`);
		return box;
	}
	const lat = (box[1] + box[3]) / 2;
	const perLat = 111_320;
	const perLon = perLat * Math.cos((lat * Math.PI) / 180);
	const round = (p: Position): Position => [+p[0].toFixed(6), +p[1].toFixed(6)];
	const tidy = (path: Path, closed: boolean, simplified: boolean) =>
		(simplified ? simplify(path, perLon, perLat, closed) : path).map(round);

	// Each layer on its own connection, so that the reads overlap: they wait on S3, not the CPU.
	const scene: Feature[] = [];
	const counts: Record<string, number> = {};
	const log: string[] = [];
	await Promise.all(
		Object.entries(LAYERS).map(async ([name, layer]) => {
			const connection = await db.connect();
			const rows = await read(connection, layer, box);
			connection.closeSync();
			let kept = 0;
			for (const { id, geometry, props } of rows) {
				const add = (kind: SceneKind, geometry: Geometry) => {
					scene.push({ type: 'Feature', properties: { kind, id, ...props }, geometry });
					kept++;
				};
				// Clipping to the square can leave several pieces, and a sliver of a polygon can
				// come back as a line; each becomes its own feature.
				const { rings, lines } = parts(geometry);
				for (const [outer, ...holes] of rings) {
					// A shape that only touches the square's edge clips to an empty polygon: no rings.
					if (!outer) continue;
					const ring = tidy(outer, true, layer.simplify);
					if (!ring.length) continue;
					const inner = holes.map((h) => tidy(h, true, layer.simplify)).filter((h) => h.length);
					add(layer.kind, { type: 'Polygon', coordinates: [ring, ...inner] });
				}
				if (!layer.lineKind) continue;
				for (const line of lines) {
					const piece = tidy(line, false, layer.simplify);
					if (piece.length > 1) add(layer.lineKind, { type: 'LineString', coordinates: piece });
				}
			}
			counts[name] = kept;
			log.push(`  ${name.padEnd(10)} ${rows.length} read → ${kept} features`);
		})
	);
	// In a steady order, whatever the order the reads finished in.
	const order = Object.values(LAYERS).flatMap((l) => [l.kind, l.lineKind ?? l.kind]);
	scene.sort(
		(a, b) =>
			order.indexOf(a.properties?.kind) - order.indexOf(b.properties?.kind) ||
			String(a.properties?.id).localeCompare(String(b.properties?.id))
	);

	const text = JSON.stringify({
		type: 'FeatureCollection',
		metadata: {
			source: `overture maps ${OVERTURE_RELEASE} (base/land forest, base/water, buildings, transportation/segment roads, base/infrastructure parking), from openstreetmap`,
			exportedAt: new Date().toISOString(),
			bounds: box.map((v) => +v.toFixed(6)),
			featureCount: scene.length,
			counts
		},
		features: scene
	});
	await writeFile(target, text);
	// All of a resort's lines together, as several resorts may be building at once.
	console.log(
		[`${source}`, ...log, `  ${target}  ${(Buffer.byteLength(text) / 1024).toFixed(0)} kB`].join(
			'\n'
		)
	);
}

/** How many resorts build at once; each runs its five layer reads in parallel too. */
const CONCURRENCY = 4;

/**
 * Build the scene for every ski features file in a directory that lacks one (all of them with
 * `--force`). The first resort builds alone, so that the one slow read of the Parquet footers
 * happens once rather than once per resort in flight; the rest go several at a time.
 */
async function buildAll(db: DuckDBInstance, dir: string, force: boolean) {
	const pending = (await readdir(dir))
		.filter((name) => name.endsWith('-ski-features.geojson'))
		.sort()
		.map((name) => ({ source: join(dir, name), target: scenePathFor(join(dir, name)) }))
		.filter(({ target }) => force || !existsSync(target));
	console.log(`${pending.length} scenes to build in ${dir}`);
	if (!pending.length) return;
	const failed: string[] = [];
	const skipped: string[] = [];
	const started = performance.now();
	let done = 0;
	// The pace is that of the resorts after the first, which paid for the footers.
	let warm = 0;
	const one = async ({ source, target }: { source: string; target: string }) => {
		try {
			const reason = await build(db, source, target);
			if (reason) skipped.push(`${source}: ${reason}`);
		} catch (error) {
			failed.push(source);
			console.error(`${source}: ${error instanceof Error ? error.message : error}`);
		}
		done++;
		const elapsed = (performance.now() - started) / 1000;
		const left = done > 1 ? ((pending.length - done) * (elapsed - warm)) / (done - 1) : NaN;
		console.log(
			`[${done}/${pending.length}] ${elapsed.toFixed(0)}s elapsed` +
				(left >= 0 ? `, ~${left.toFixed(0)}s left` : '')
		);
	};
	await one(pending[0]);
	warm = (performance.now() - started) / 1000;
	const queue = pending.slice(1);
	await Promise.all(
		Array.from({ length: CONCURRENCY }, async () => {
			for (let next = queue.shift(); next; next = queue.shift()) await one(next);
		})
	);
	if (skipped.length) console.log(`\n${skipped.length} skipped:\n  ${skipped.join('\n  ')}`);
	if (failed.length) {
		console.error(`\n${failed.length} failed:\n  ${failed.join('\n  ')}`);
		process.exitCode = 1;
	}
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const [command = 'help', source = DEFAULT_FEATURES, target] = args.filter((a) => a !== '--force');

if (command === 'build') {
	await build(await openOverture(), source, target);
} else if (command === 'build-all') {
	await buildAll(await openOverture(), source, force);
} else {
	console.log(`usage: pnpm diorama-scene build [features.geojson] [scene.geojson]
       pnpm diorama-scene build-all dir/ [--force]

  build      fetch the woods, water, buildings, roads and car parks around the runs and lifts
             in a ski features file (default ${DEFAULT_FEATURES}) and
             write them to the output path, or beside the features file as <name>-scene.geojson
             when none is given
  build-all  the same for every *-ski-features.geojson in a directory that has no scene yet
             (every one with --force), sharing one Overture session: the first resort takes
             a minute or two, each after that a few seconds`);
}
