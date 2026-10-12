/**
 * Tokyo Outline data pipeline. Run `pnpm tokyo-outline help`.
 *
 * Reads 国土数値情報 行政区域データ (N03) for 東京都 and writes the prefecture's coastline, the
 * borders between its municipalities and each municipality's own shape to
 * src/lib/tokyo-outline/outline.json, which the /tokyo-outline page bundles. `dem` then bakes
 * the elevation grid the page draws contours and relief from.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { format, resolveConfig } from 'prettier';
import type { FeatureCollection, Geometry, GeometryCollection, Position } from 'geojson';
import { PNG } from 'pngjs';
import { xToLon, yToLat } from '../src/lib/contour/mercator.ts';
import { findProvider, loadTile, setImageDecoder } from '../src/lib/contour/terrain-api.ts';
import { encodeDem, type DemMeta } from '../src/lib/tokyo-outline/dem.ts';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, 'data', 'tokyo-outline');
const OUT = join(ROOT, 'src', 'lib', 'tokyo-outline', 'outline.json');

const EDITION = 'N03-20250101';
const SOURCE = `https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/${EDITION}_13_GML.zip`;
const GEOJSON = `${EDITION}_13.geojson`;

// Simplifying each municipality on its own would pull shared borders apart, so mapshaper does
// it on the shared topology. Not a dependency: it's only needed to rebuild the data.
const MAPSHAPER = 'mapshaper@0.7.83';
const TOLERANCE = 20; // metres; about a pixel on a 4096 px export of the mainland
const MIN_ISLAND = 20000; // m²; drops wharf fragments and offshore rocks

const DEM_OUT = join(ROOT, 'static', 'tokyo-outline', 'dem.bin');
const DEM_META = join(ROOT, 'src', 'lib', 'tokyo-outline', 'dem.json');
// 44 m cells: a little finer than a pixel of the mainland on a 2048 px export.
const DEM_WIDTH = 2048;
const DEM_PAD = 0.004; // degrees of margin around the mainland
// z16 is where the 1 m lidar layer starts. A tile there is 2 m a pixel, so each cell of the
// grid is the mean of some 500 soundings.
const DEM_ZOOM = 16;
const DEM_PARALLEL = 12;

const [command = 'help', ...flags] = process.argv.slice(2);

const rel = (path: string) => path.replace(ROOT + '/', '');
const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false
	);

async function source(): Promise<string> {
	const path = join(CACHE, GEOJSON);
	if (await exists(path)) return path;
	console.log(`downloading ${SOURCE}`);
	const res = await fetch(SOURCE);
	if (!res.ok) throw new Error(`${SOURCE}: ${res.status} ${res.statusText}`);
	const files = unzipSync(new Uint8Array(await res.arrayBuffer()), {
		filter: (f) => f.name.endsWith(GEOJSON)
	});
	const [bytes] = Object.values(files);
	if (!bytes) throw new Error(`${GEOJSON} not in the archive`);
	await mkdir(CACHE, { recursive: true });
	await writeFile(path, bytes);
	return path;
}

type Props = { region: string; code?: string };

/** Every line or ring of a geometry as flat [lon, lat, lon, lat, …]. */
function flatLines(g: Geometry): number[][] {
	const lines: Position[][] =
		g.type === 'LineString'
			? [g.coordinates]
			: g.type === 'MultiLineString' || g.type === 'Polygon'
				? g.coordinates
				: g.type === 'MultiPolygon'
					? g.coordinates.flat()
					: [];
	return lines.map((l) => l.flat());
}

const read = async (
	name: string
): Promise<FeatureCollection<Geometry, Props> | GeometryCollection> =>
	JSON.parse(await readFile(join(CACHE, `${name}.json`), 'utf8'));

/** Every line or ring in a layer, grouped by `region`. */
async function layer(name: string): Promise<Record<string, number[][]>> {
	const data = await read(name);
	// mapshaper writes a layer with no attributes, like the borders, as bare geometries. Only
	// the mainland has any: no two island municipalities share a land border.
	const parts =
		data.type === 'GeometryCollection'
			? data.geometries.map((geometry) => ({ geometry, region: 'mainland' }))
			: data.features.map((f) => ({ geometry: f.geometry, region: f.properties.region }));
	const out: Record<string, number[][]> = {};
	for (const { geometry, region } of parts) (out[region] ??= []).push(...flatLines(geometry));
	return out;
}

/** Each municipality's rings, in code order: 区, then 市, then 町村. */
async function municipalities() {
	const data = await read('areas');
	if (data.type !== 'FeatureCollection') throw new Error('areas: no attributes');
	return data.features
		.map((f) => ({
			code: f.properties.code!,
			region: f.properties.region,
			rings: flatLines(f.geometry)
		}))
		.sort((a, b) => a.code.localeCompare(b.code));
}

async function build() {
	const input = await source();
	// 小笠原村 and the uninhabited islets south of 青ヶ島 are left out: they sit up to 1,800 km
	// from the mainland. 所属未定地 (unassigned reclaimed land) stays as part of the coast.
	await promisify(execFile)(
		'pnpm',
		[
			'dlx',
			MAPSHAPER,
			...['-i', input],
			...['-each', 'lat = this.centroidY'],
			...['-filter', 'N03_007 != "13421" && lat > 32'],
			...['-each', 'region = lat > 35.2 ? "mainland" : "izu"'],
			...['-dissolve', 'N03_007', 'copy-fields=region', 'name=areas'],
			...['-rename-fields', 'code=N03_007'],
			...['-simplify', 'dp', `interval=${TOLERANCE}`, 'keep-shapes'],
			...['-filter-islands', `min-area=${MIN_ISLAND}`],
			...['-innerlines', '+', 'name=borders'],
			...['-dissolve', 'region', 'target=areas', '+', 'name=outline'],
			...['-o', 'target=areas,borders,outline', 'format=geojson', 'precision=0.00001', CACHE + '/']
		],
		{ maxBuffer: 1 << 26 }
	);

	const outline = await layer('outline');
	const borders = await layer('borders');
	const areas = await municipalities();
	// Formatted, so the bundled file passes `pnpm lint`.
	const text = await format(
		JSON.stringify({
			edition: EDITION,
			mainland: { outline: outline.mainland, borders: borders.mainland },
			izu: { outline: outline.izu },
			areas
		}),
		{ ...(await resolveConfig(OUT)), filepath: OUT }
	);
	await mkdir(join(OUT, '..'), { recursive: true });
	await writeFile(OUT, text);

	const points = (lines: number[][]) => lines.reduce((n, l) => n + l.length / 2, 0);
	console.log(`mainland: ${outline.mainland.length} rings, ${points(outline.mainland)} points`);
	console.log(`borders:  ${borders.mainland.length} lines, ${points(borders.mainland)} points`);
	console.log(`izu:      ${outline.izu.length} rings, ${points(outline.izu)} points`);
	console.log(`areas:    ${areas.length}, ${points(areas.flatMap((a) => a.rings))} points`);
	console.log(`  ${rel(OUT)}  ${(Buffer.byteLength(text) / 1024).toFixed(0)} kB`);
}

// ── elevation ───────────────────────────────────────

/** Grid points inside the rings (even-odd), grown by `grow` points so slopes reach the coast. */
function landMask(rings: number[][], meta: DemMeta, grow: number): Uint8Array {
	const { width, height } = meta;
	const mask = new Uint8Array(width * height);
	for (let j = 0; j < height; j++) {
		const lat = meta.north - j * meta.dlat;
		const crossings: number[] = [];
		for (const ring of rings) {
			for (let k = 0; k + 3 < ring.length; k += 2) {
				const [x0, y0, x1, y1] = [ring[k], ring[k + 1], ring[k + 2], ring[k + 3]];
				if (y0 > lat !== y1 > lat) crossings.push(x0 + ((lat - y0) / (y1 - y0)) * (x1 - x0));
			}
		}
		crossings.sort((a, b) => a - b);
		for (let k = 0; k + 1 < crossings.length; k += 2) {
			const i0 = Math.max(0, Math.ceil((crossings[k] - meta.west) / meta.dlon));
			const i1 = Math.min(width - 1, Math.floor((crossings[k + 1] - meta.west) / meta.dlon));
			for (let i = i0; i <= i1; i++) mask[j * width + i] = 1;
		}
	}
	let grown = mask;
	for (let step = 0; step < grow; step++) {
		const next = grown.slice();
		for (let j = 0; j < height; j++) {
			for (let i = 0; i < width; i++) {
				if (grown[j * width + i]) continue;
				if (
					(i > 0 && grown[j * width + i - 1]) ||
					(i < width - 1 && grown[j * width + i + 1]) ||
					(j > 0 && grown[(j - 1) * width + i]) ||
					(j < height - 1 && grown[(j + 1) * width + i])
				)
					next[j * width + i] = 1;
			}
		}
		grown = next;
	}
	return grown;
}

async function dem() {
	const zoom = Number(flags.find((f) => f.startsWith('--zoom='))?.slice(7) ?? DEM_ZOOM);
	const provider = findProvider('gsi-1m');
	// Tiles come as PNG; the browser decodes them with a canvas, here pngjs does.
	setImageDecoder(async (image) => {
		const { width, height, data } = PNG.sync.read(Buffer.from(await image.arrayBuffer()));
		return {
			width,
			height,
			data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length)
		};
	});

	const { mainland }: { mainland: { outline: number[][] } } = JSON.parse(
		await readFile(OUT, 'utf8')
	);
	let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const ring of mainland.outline) {
		for (let i = 0; i < ring.length; i += 2) {
			west = Math.min(west, ring[i]);
			east = Math.max(east, ring[i]);
			south = Math.min(south, ring[i + 1]);
			north = Math.max(north, ring[i + 1]);
		}
	}
	west -= DEM_PAD;
	east += DEM_PAD;
	south -= DEM_PAD;
	north += DEM_PAD;
	const dlon = (east - west) / (DEM_WIDTH - 1);
	// Square on the ground at the middle latitude, as the page draws it.
	const dlat = dlon * Math.cos((((south + north) / 2) * Math.PI) / 180);
	const meta: DemMeta = {
		width: DEM_WIDTH,
		height: Math.ceil((north - south) / dlat) + 1,
		west,
		north,
		dlon,
		dlat,
		cell: Math.round(dlat * 111_320),
		source: `${provider.id} z${zoom}`
	};
	const { width, height } = meta;
	const mask = landMask(mainland.outline, meta, 3);

	// Only the tiles with land under them: the box around Tokyo is half Saitama and Kanagawa.
	const n = 2 ** zoom;
	const column = (i: number) => Math.floor(((west + i * dlon + 180) / 360) * n);
	const row = (j: number) => {
		const s = Math.sin(((north - j * dlat) * Math.PI) / 180);
		return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
	};
	const wanted = new Set<string>();
	for (let j = 0; j < height; j++) {
		const ty = row(j);
		for (let i = 0; i < width; i++) if (mask[j * width + i]) wanted.add(`${column(i)}/${ty}`);
	}
	// Siblings together, so the parent a patchy tile falls back to is still cached for the next.
	const tiles = [...wanted]
		.map((key) => key.split('/').map(Number))
		.sort((a, b) => (a[1] >> 1) - (b[1] >> 1) || (a[0] >> 1) - (b[0] >> 1));
	console.log(`${width} × ${height} grid, ${meta.cell} m cells, ${tiles.length} z${zoom} tiles`);

	const sum = new Float64Array(width * height);
	const count = new Uint32Array(width * height);
	let done = 0;
	let next = 0;
	async function worker() {
		while (next < tiles.length) {
			const [tx, ty] = tiles[next++];
			let tile: Awaited<ReturnType<typeof loadTile>>;
			for (let attempt = 1; ; attempt++) {
				try {
					tile = await loadTile(provider, zoom, tx, ty);
					break;
				} catch (e) {
					if (attempt === 4) throw e;
					await new Promise((r) => setTimeout(r, 1000 * attempt));
				}
			}
			if (++done % 500 === 0) console.log(`  ${done} / ${tiles.length}`);
			if (!tile) continue;
			const { size, data } = tile;
			for (let py = 0; py < size; py++) {
				const j = Math.round((north - yToLat((ty + (py + 0.5) / size) / n)) / dlat);
				if (j < 0 || j >= height) continue;
				for (let px = 0; px < size; px++) {
					const v = data[py * size + px];
					if (Number.isNaN(v)) continue;
					const i = Math.round((xToLon((tx + (px + 0.5) / size) / n) - west) / dlon);
					if (i < 0 || i >= width) continue;
					sum[j * width + i] += v;
					count[j * width + i]++;
				}
			}
		}
	}
	await Promise.all(Array.from({ length: DEM_PARALLEL }, worker));

	const grid = new Float32Array(width * height).fill(NaN);
	let filled = 0;
	let [low, high] = [Infinity, -Infinity];
	for (let k = 0; k < grid.length; k++) {
		if (!mask[k] || !count[k]) continue;
		grid[k] = sum[k] / count[k];
		low = Math.min(low, grid[k]);
		high = Math.max(high, grid[k]);
		filled++;
	}
	const wantedCells = mask.reduce((a, b) => a + b, 0);
	console.log(
		`${filled} of ${wantedCells} cells filled, ${low.toFixed(1)} m to ${high.toFixed(1)} m`
	);

	const bytes = encodeDem(grid, width);
	await mkdir(join(DEM_OUT, '..'), { recursive: true });
	await writeFile(DEM_OUT, bytes);
	await writeFile(
		DEM_META,
		await format(JSON.stringify(meta), { ...(await resolveConfig(DEM_META)), filepath: DEM_META })
	);
	console.log(`  ${rel(DEM_OUT)}  ${(bytes.length / 1024).toFixed(0)} kB`);
	console.log(`  ${rel(DEM_META)}`);
}

if (command === 'build') await build();
else if (command === 'dem') await dem();
else
	console.log(`usage: pnpm tokyo-outline <command>

  build   download ${EDITION} for 東京都 (cached in ${rel(CACHE)}/) and write ${rel(OUT)}
  dem     average 国土地理院 elevation tiles over the mainland into ${rel(DEM_OUT)}
          --zoom=${DEM_ZOOM}  tile zoom to read: 16 is the 1 m layer, 15 the 5 m, below that 10 m`);
