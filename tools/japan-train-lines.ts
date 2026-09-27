/**
 * Japan Train Lines data pipeline. Run `pnpm japan-train-lines help`.
 *
 * Everything lands in static/japan-train-lines/, which the /japan-train-lines-flat and
 * /japan-train-lines-3d pages fetch at runtime. `build` must be rerun whenever the railroad
 * GeoJSON or the region definitions in src/lib/train-lines/regions.js change.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type {
	Feature,
	FeatureCollection,
	Geometry,
	MultiPolygon,
	Polygon,
	Position
} from 'geojson';
import { regions } from '../src/lib/train-lines/regions.js';

const STATIC = join(import.meta.dirname, '..', 'static', 'japan-train-lines');
const DOWNLOAD_BASE = 'https://content.liquidx.net/japan-train-lines';
const DOWNLOADS = ['N02-19_Station.geojson', 'N02-19_RailroadSection.geojson'];

const [command = 'help'] = process.argv.slice(2);

const kb = (s: string) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} kB`;
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8'));

async function write(name: string, text: string) {
	await mkdir(STATIC, { recursive: true });
	await writeFile(join(STATIC, name), text);
	console.log(`  ${join(STATIC, name).replace(process.cwd() + '/', '')}  ${kb(text)}`);
}

// ── download ────────────────────────────────────────

async function download() {
	for (const name of DOWNLOADS) {
		const res = await fetch(`${DOWNLOAD_BASE}/${name}`);
		if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
		await write(name, await res.text());
	}
}

// ── prefecture polygons ─────────────────────────────

type Area = Polygon | MultiPolygon;

const TOLERANCE = 0.01; // degrees (~1 km), enough for point-in-polygon
const MIN_RING_POINTS = 4; // drop rings that collapse under simplification
const MIN_RING_AREA = 0.0001; // drop tiny islands (square degrees)

// prettier-ignore
const PREFECTURE_CODES: Record<string, string> = {
	北海道: '01', 青森県: '02', 岩手県: '03', 宮城県: '04', 秋田県: '05', 山形県: '06',
	福島県: '07', 茨城県: '08', 栃木県: '09', 群馬県: '10', 埼玉県: '11', 千葉県: '12',
	東京都: '13', 神奈川県: '14', 新潟県: '15', 富山県: '16', 石川県: '17', 福井県: '18',
	山梨県: '19', 長野県: '20', 岐阜県: '21', 静岡県: '22', 愛知県: '23', 三重県: '24',
	滋賀県: '25', 京都府: '26', 大阪府: '27', 兵庫県: '28', 奈良県: '29', 和歌山県: '30',
	鳥取県: '31', 島根県: '32', 岡山県: '33', 広島県: '34', 山口県: '35', 徳島県: '36',
	香川県: '37', 愛媛県: '38', 高知県: '39', 福岡県: '40', 佐賀県: '41', 長崎県: '42',
	熊本県: '43', 大分県: '44', 宮崎県: '45', 鹿児島県: '46', 沖縄県: '47'
};

function perpDist([px, py]: Position, [ax, ay]: Position, [bx, by]: Position) {
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.hypot(px - ax, py - ay);
	return Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(lenSq);
}

function douglasPeucker(pts: Position[], tol: number): Position[] {
	if (pts.length <= 2) return pts;
	let maxD = 0;
	let idx = 0;
	for (let i = 1; i < pts.length - 1; i++) {
		const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
		if (d > maxD) {
			maxD = d;
			idx = i;
		}
	}
	if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
	const left = douglasPeucker(pts.slice(0, idx + 1), tol);
	const right = douglasPeucker(pts.slice(idx), tol);
	return [...left.slice(0, -1), ...right];
}

function ringArea(ring: Position[]) {
	let area = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
		area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
	return Math.abs(area / 2);
}

/** Simplified outer ring only; holes are dropped. */
function simplifyPolygon(rings: Position[][]): Position[][] | null {
	const outer = douglasPeucker(rings[0], TOLERANCE);
	if (outer.length < MIN_RING_POINTS) return null;
	const [first, last] = [outer[0], outer[outer.length - 1]];
	if (first[0] !== last[0] || first[1] !== last[1]) outer.push(first);
	if (ringArea(outer) < MIN_RING_AREA) return null;
	return [outer];
}

function simplifyGeometry(geom: Geometry): Area | null {
	if (geom.type === 'Polygon') {
		const rings = simplifyPolygon(geom.coordinates);
		return rings && { type: 'Polygon', coordinates: rings };
	}
	if (geom.type === 'MultiPolygon') {
		const polys = geom.coordinates.map(simplifyPolygon).filter((p) => p !== null);
		return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
	}
	return null;
}

const countPoints = (geom: Geometry) =>
	geom.type === 'Polygon'
		? geom.coordinates.flat().length
		: geom.type === 'MultiPolygon'
			? geom.coordinates.flat(2).length
			: 0;

async function prefectures() {
	const source = createRequire(import.meta.url).resolve(
		'open-data-jp-prefectures-geojson/output/prefectures.geojson'
	);
	const raw = await readJson<FeatureCollection<Geometry, { P: string }>>(source);

	const result: Record<string, Area> = {};
	let before = 0;
	let after = 0;
	for (const feature of raw.features) {
		const name = feature.properties.P;
		const code = PREFECTURE_CODES[name];
		if (!code) {
			console.warn(`  unknown prefecture: ${name}`);
			continue;
		}
		const simplified = simplifyGeometry(feature.geometry);
		if (!simplified) {
			console.warn(`  dropped: ${name}`);
			continue;
		}
		before += countPoints(feature.geometry);
		after += countPoints(simplified);
		result[code] = simplified;
	}

	console.log(`prefecture polygons: ${Object.keys(result).length} prefectures`);
	console.log(
		`  points ${before.toLocaleString()} → ${after.toLocaleString()} (${((1 - after / before) * 100).toFixed(1)}% fewer)`
	);
	await write('prefecture-polygons.json', JSON.stringify(result));
}

// ── line → region index ─────────────────────────────

type RailProps = { 路線名?: string; 運営会社?: string };

function pointInRing([x, y]: Position, ring: Position[]) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

const pointInArea = (p: Position, area: Area) =>
	area.type === 'Polygon'
		? pointInRing(p, area.coordinates[0])
		: area.coordinates.some((poly) => pointInRing(p, poly[0]));

/** Every `stride`th vertex of each line, plus its last. */
function sampleCoords(geom: Geometry, stride = 3): Position[] {
	const lines =
		geom.type === 'LineString'
			? [geom.coordinates]
			: geom.type === 'MultiLineString'
				? geom.coordinates
				: [];
	const out: Position[] = [];
	for (const line of lines) {
		for (let i = 0; i < line.length; i += stride) out.push(line[i]);
		const last = line[line.length - 1];
		if (out[out.length - 1] !== last) out.push(last);
	}
	return out;
}

async function index() {
	const railroad = await readJson<FeatureCollection<Geometry, RailProps>>(
		join(STATIC, 'N02-19_RailroadSection.geojson')
	);
	const polygons = await readJson<Record<string, Area>>(join(STATIC, 'prefecture-polygons.json'));

	const areas = (regions as { id: string; prefectures?: string[] }[])
		.filter((r) => r.prefectures)
		.map((r) => ({
			id: r.id,
			areas: r.prefectures!.map((code) => polygons[code]).filter(Boolean)
		}));

	const found = new Map<string, Set<string>>(); // "company::line" → region ids
	let features = 0;
	for (const feature of railroad.features as Feature<Geometry, RailProps>[]) {
		const line = feature.properties?.路線名;
		const company = feature.properties?.運営会社;
		if (!line || !company) continue;
		features++;

		const key = `${company}::${line}`;
		const entry = found.get(key) ?? new Set();
		found.set(key, entry);
		if (entry.size === areas.length) continue;

		for (const p of sampleCoords(feature.geometry)) {
			for (const region of areas)
				if (!entry.has(region.id) && region.areas.some((a) => pointInArea(p, a)))
					entry.add(region.id);
			if (entry.size === areas.length) break;
		}
	}

	const result = Object.fromEntries([...found].map(([k, v]) => [k, [...v]]));
	console.log(`line region index: ${features} features, ${found.size} lines`);
	await write('line-region-index.json', JSON.stringify(result));
}

// ── cli ─────────────────────────────────────────────

const COMMANDS: Record<string, [() => Promise<void>, string]> = {
	download: [download, 'fetch the n02-19 railroad and station geojson'],
	build: [
		async () => {
			await prefectures();
			await index();
		},
		'prefectures, then index'
	],
	prefectures: [prefectures, 'simplify prefecture boundaries → prefecture-polygons.json'],
	index: [index, 'assign each company/line to regions → line-region-index.json'],
	help: [
		async () => {
			console.log('pnpm japan-train-lines <command>\n');
			for (const [name, [, text]] of Object.entries(COMMANDS))
				console.log(`  ${name.padEnd(12)} ${text}`);
		},
		'this list'
	]
};

const run = COMMANDS[command]?.[0];
if (!run) {
	console.error(`unknown command: ${command}`);
	process.exitCode = 1;
} else await run();
