/**
 * EV Charging Japan data pipeline and exploration CLI. Run `pnpm ev-jp help`.
 *
 * `build` turns the sources in tools/ev-jp/source/ into the files the /ev-jp page bundles
 * (src/lib/ev/data/) plus full GIS exports in data/ev-jp/.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeGrid, distanceAt, type RawGrid } from '../src/lib/ev/model.ts';
import { decodeCoastline, landRings, outlineGeoJson } from '../src/lib/ev/pipeline/coast.ts';
import { haversine } from '../src/lib/ev/pipeline/geo.ts';
import { distanceGrid } from '../src/lib/ev/pipeline/grid.ts';
import {
	featureCollection,
	parseChargersKml,
	toCompactRows,
	toCsv,
	type ChargerFeature
} from '../src/lib/ev/pipeline/kml.ts';
import { analyseRoutes } from '../src/lib/ev/pipeline/routes.ts';

const SOURCE = join(import.meta.dirname, 'ev-jp', 'source');
const APP_DATA = join(import.meta.dirname, '..', 'src', 'lib', 'ev', 'data');
const EXPORTS = join(process.cwd(), 'data', 'ev-jp');

const [command = 'help'] = process.argv.slice(2);

const json = (v: unknown, indent?: number) => JSON.stringify(v, null, indent);
const kb = (s: string) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} kB`;

async function write(dir: string, name: string, text: string) {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), text);
	console.log(`  ${join(dir, name).replace(process.cwd() + '/', '')}  ${kb(text)}`);
}

async function chargers(): Promise<ChargerFeature[]> {
	return parseChargersKml(await readFile(join(SOURCE, 'hokkaido-chargers.kml'), 'utf8'));
}

const fastSites = (features: ChargerFeature[]) =>
	features
		.filter((f) => f.properties.dc_fast)
		.map((f) => ({
			lon: f.geometry.coordinates[0],
			lat: f.geometry.coordinates[1],
			name: f.properties.name,
			open24h: f.properties.open_24h,
			props: f.properties
		}));

async function build() {
	const all = await chargers();
	const dc = all.filter((f) => f.properties.dc_fast);
	const rings = decodeCoastline(await readFile(join(SOURCE, 'hokkaido-coastline.txt'), 'utf8'));
	const rows = toCompactRows(all);

	console.log('exports');
	await write(
		EXPORTS,
		'hokkaido_chargers_all.geojson',
		json(featureCollection(all, 'hokkaido_ev_chargers_all'), 1)
	);
	await write(
		EXPORTS,
		'hokkaido_chademo_dc.geojson',
		json(featureCollection(dc, 'hokkaido_chademo_dc_fast'), 1)
	);
	await write(EXPORTS, 'hokkaido_chargers_all.csv', toCsv(all));
	await write(EXPORTS, 'hokkaido_outline.geojson', json(outlineGeoJson(rings)));

	console.log('app data');
	await write(APP_DATA, 'chargers.json', json(rows));
	await write(APP_DATA, 'distance-grid.json', json(distanceGrid(landRings(rings), fastSites(all))));
	// Routes use the compact rows' 4-decimal positions, as the page does.
	const routeSites = rows
		.filter((r) => r[3] & 1)
		.map(([lon, lat, name, , status]) => ({ lon, lat, name, open24h: !!(status & 1) }));
	const routes = Object.fromEntries(analyseRoutes(routeSites).map(({ name, ...r }) => [name, r]));
	await write(APP_DATA, 'routes.json', json(routes, 1) + '\n');

	const dc24 = dc.filter((f) => f.properties.open_24h).length;
	console.log(`\n${all.length} sites · ${dc.length} fast · ${dc24} fast open 24h`);
}

async function inspect() {
	const kml = await readFile(join(SOURCE, 'hokkaido-chargers.kml'), 'utf8');
	const blocks = [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].map((m) => m[1]);
	console.log(`placemarks: ${blocks.length}`);
	for (const i of [0, 400, 900])
		console.log('='.repeat(50), '\n' + blocks[i]?.trim().slice(0, 700));
}

/** Towns and capes around the island, for spot checks. */
const WAYPOINTS: [string, number, number][] = [
	['札幌 Sapporo', 43.062, 141.354],
	['小樽 Otaru', 43.19, 140.994],
	['ニセコ Niseko', 42.805, 140.687],
	['函館 Hakodate', 41.768, 140.729],
	['松前 Matsumae', 41.43, 140.109],
	['江差 Esashi', 41.869, 140.128],
	['せたな Setana', 42.451, 139.85],
	['寿都 Suttsu', 42.794, 140.224],
	['岩内 Iwanai', 42.976, 140.51],
	['苫小牧 Tomakomai', 42.637, 141.604],
	['室蘭 Muroran', 42.317, 140.974],
	['洞爺 Toya', 42.593, 140.766],
	['襟裳岬 Cape Erimo', 41.925, 143.246],
	['浦河 Urakawa', 42.168, 142.768],
	['新ひだか Shizunai', 42.341, 142.368],
	['広尾 Hiroo', 42.284, 143.312],
	['帯広 Obihiro', 42.924, 143.196],
	['釧路 Kushiro', 42.985, 144.382],
	['根室 Nemuro', 43.33, 145.583],
	['納沙布岬 Nosappu', 43.385, 145.817],
	['別海 Betsukai', 43.394, 145.121],
	['中標津 Nakashibetsu', 43.554, 144.976],
	['羅臼 Rausu', 44.023, 145.196],
	['ウトロ Utoro', 44.076, 144.994],
	['斜里 Shari', 43.909, 144.664],
	['網走 Abashiri', 44.021, 144.274],
	['北見 Kitami', 43.803, 143.895],
	['紋別 Monbetsu', 44.356, 143.354],
	['雄武 Omu', 44.585, 142.958],
	['枝幸 Esashi-Okhotsk', 44.94, 142.583],
	['浜頓別 Hamatonbetsu', 45.117, 142.363],
	['宗谷岬 Cape Soya', 45.523, 141.937],
	['稚内 Wakkanai', 45.415, 141.673],
	['天塩 Teshio', 44.885, 141.745],
	['羽幌 Haboro', 44.359, 141.7],
	['留萌 Rumoi', 43.943, 141.643],
	['旭川 Asahikawa', 43.771, 142.365],
	['富良野 Furano', 43.342, 142.383],
	['美瑛 Biei', 43.588, 142.467],
	['層雲峡 Sounkyo', 43.72, 143.03],
	['名寄 Nayoro', 44.357, 142.463],
	['音威子府 Otoineppu', 44.727, 142.267],
	['弟子屈 Teshikaga', 43.487, 144.454],
	['阿寒湖 Lake Akan', 43.454, 144.093],
	['トマム Tomamu', 43.062, 142.622],
	['利尻島 Rishiri', 45.183, 141.23],
	['礼文島 Rebun', 45.3, 141.045]
];

function nearest<T extends { lon: number; lat: number }>(lon: number, lat: number, sites: T[]) {
	let best = { d: Infinity, site: sites[0] };
	for (const s of sites) {
		const d = haversine(lon, lat, s.lon, s.lat);
		if (d < best.d) best = { d, site: s };
	}
	return best;
}

async function waypoints() {
	const fast = fastSites(await chargers());
	const fast24 = fast.filter((s) => s.open24h);
	const rows = WAYPOINTS.map(([name, lat, lon]) => ({
		name,
		a: nearest(lon, lat, fast),
		b: nearest(lon, lat, fast24)
	})).sort((x, y) => y.a.d - x.a.d);
	console.log(`${'waypoint'.padEnd(26)} ${'nearest'.padStart(9)} ${'24h'.padStart(8)}  site`);
	for (const r of rows)
		console.log(
			`${r.name.padEnd(26)} ${r.a.d.toFixed(1).padStart(7)}km ${r.b.d.toFixed(1).padStart(6)}km  ${r.a.site.name.slice(0, 44)}`
		);
}

async function isolated() {
	const fast = fastSites(await chargers());
	const spacing = fast
		.map((s, i) => ({
			name: s.name,
			d: nearest(
				s.lon,
				s.lat,
				fast.filter((_, j) => j !== i)
			).d
		}))
		.sort((a, b) => b.d - a.d);
	console.log('most isolated fast chargers (km to the next nearest)');
	for (const s of spacing.slice(0, 18))
		console.log(`${s.d.toFixed(1).padStart(7)} km  ${s.name.slice(0, 60)}`);
	console.log(`\n${fast.length} fast · ${fast.filter((s) => s.open24h).length} open 24h`);
}

const SITE_TYPES: [string, RegExp][] = [
	['nissan dealer', /日産/],
	['toyota dealer', /トヨタ|ネッツ|カローラ/],
	['mitsubishi dealer', /三菱/],
	['道の駅 roadside station', /道の駅/],
	['retail / conbini', /イオン|ホーマック|コープ|セブン|ローソン|ファミリーマート/],
	['hotel / onsen', /ホテル|旅館|リゾート|温泉|ホステル/],
	['municipal office', /役場|庁舎|市役所|支所|センター/],
	['petrol station', /ENEOS|コスモ|出光|SS|石油|オカモト/],
	['expressway sa / pa', /NEXCO|SA|PA|高速/]
];

async function summary() {
	const grid = decodeGrid(
		JSON.parse(await readFile(join(APP_DATA, 'distance-grid.json'), 'utf8')) as RawGrid
	);
	const cells = [];
	for (let iy = 0; iy < grid.ny; iy++)
		for (let ix = 0; ix < grid.nx; ix++) {
			const lon = grid.lo0 + ix * grid.step;
			const lat = grid.la0 + iy * grid.step;
			const d = distanceAt(grid, 'all', lon, lat);
			if (!Number.isNaN(d)) cells.push({ d, lon, lat });
		}
	console.log('remotest land (km to the nearest fast charger)');
	for (const c of cells.sort((a, b) => b.d - a.d).slice(0, 14))
		console.log(`  ${String(c.d).padStart(3)} km   ${c.lat.toFixed(2)}n ${c.lon.toFixed(2)}e`);

	const p = fastSites(await chargers()).map((s) => s.props);
	const n = p.length;
	const pct = (c: number) =>
		`${String(c).padStart(3)} (${String(Math.floor((c * 100) / n)).padStart(2)}%)`;
	const count = (f: (x: (typeof p)[number]) => boolean) => p.filter(f).length;
	console.log(`\n${n} fast chargers`);
	console.log('  open 24h         ', pct(count((x) => x.open_24h)));
	console.log('  card / app needed', pct(count((x) => x.card_or_app_required)));
	console.log('  emp network      ', pct(count((x) => x.emp_network)));
	console.log('  tesla only       ', pct(count((x) => x.tesla)));

	const types = new Map<string, number>();
	for (const x of p) {
		const type = SITE_TYPES.find(([, re]) => re.test(x.name))?.[0] ?? 'other';
		types.set(type, (types.get(type) ?? 0) + 1);
	}
	console.log('\nsite type');
	for (const [k, v] of [...types].sort((a, b) => b[1] - a[1]))
		console.log(`  ${k.padEnd(26)} ${String(v).padStart(4)}  (${Math.floor((v * 100) / n)}%)`);

	const dealers = p.filter((x) => /日産|トヨタ|三菱|ネッツ|マツダ|スバル|ホンダ/.test(x.name));
	console.log(
		`\ndealerships: ${dealers.length}, of which open 24h: ${dealers.filter((x) => x.open_24h).length}`
	);
	console.log('\nclosing days on some daytime sites');
	for (const x of p.filter((z) => !z.open_24h).slice(0, 6))
		console.log(
			`  ${x.name.slice(0, 34).padEnd(36)} ${x.hours.slice(0, 18).padEnd(20)} closed: ${(x.closed ?? '').slice(0, 26)}`
		);
}

const COMMANDS: Record<string, [() => Promise<void>, string]> = {
	build: [build, 'regenerate app data and gis exports from tools/ev-jp/source'],
	inspect: [inspect, 'print sample placemarks from the source kml'],
	waypoints: [waypoints, 'distance from towns and capes to the nearest fast charger'],
	isolated: [isolated, 'fast chargers ranked by distance to their nearest neighbour'],
	summary: [summary, 'remotest land, access flags and site types'],
	help: [
		async () => {
			console.log('pnpm ev-jp <command>\n');
			for (const [name, [, text]] of Object.entries(COMMANDS))
				console.log(`  ${name.padEnd(10)} ${text}`);
		},
		'this list'
	]
};

const run = COMMANDS[command]?.[0];
if (!run) {
	console.error(`unknown command: ${command}`);
	process.exitCode = 1;
} else await run();
