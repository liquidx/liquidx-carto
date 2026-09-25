/**
 * ODPT ingest CLI. Run `pnpm odpt help`.
 * Tokens come from .env: ODPT_ACCESS_TOKEN, ODPT_CHALLENGE_ACCESS_TOKEN.
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { findOdptFeed, odptGtfsFeeds, type OdptAccess } from '../src/lib/transit/odpt/catalog.ts';
import { OdptClient } from '../src/lib/transit/odpt/client.ts';
import { parseGtfsZip } from '../src/lib/transit/gtfs/feed.ts';
import {
	buildTimetable,
	positionsAt,
	tripsOn,
	type Timetable
} from '../src/lib/transit/gtfs/timetable.ts';
import { formatGtfsTime, nowIn, parseGtfsTime } from '../src/lib/transit/gtfs/time.ts';

const DATA = join(process.cwd(), 'data', 'odpt');
const GTFS_DIR = join(DATA, 'gtfs');

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		all: { type: 'boolean' },
		date: { type: 'string' },
		time: { type: 'string' },
		limit: { type: 'string' },
		access: { type: 'string' },
		path: { type: 'string' },
		operator: { type: 'string' },
		dump: { type: 'boolean' },
		out: { type: 'string' }
	}
});
const [command = 'help', ...args] = positionals;

const client = new OdptClient({
	token: process.env.ODPT_ACCESS_TOKEN,
	challengeToken: process.env.ODPT_CHALLENGE_ACCESS_TOKEN
});

const HELP = `usage: pnpm odpt <command>

  feeds                          list known rail GTFS feeds and whether your tokens cover them
  fetch <id…> | --all            download GTFS zips to data/odpt/gtfs/
  fetch <id> --path <p> --access public|basic|challenge
                                 download any file under /api/v4/files/ (e.g. a bus feed)
  info <id>                      summarise a downloaded feed
  at <id…> [--date YYYYMMDD] [--time HH:MM]
                                 trains running at a moment, with interpolated positions
  export <id> [--date YYYYMMDD] [--out file]
                                 write a compact JSON timetable for one service day
  query <Type> [key=value…] [--operator Toei] [--access public|basic|challenge] [--dump] [--out file]
                                 call the JSON API, e.g. query Station --operator Toei --access public`;

async function main() {
	switch (command) {
		case 'feeds':
			return feeds();
		case 'fetch':
			return fetchFeeds();
		case 'info':
			return info(need(args[0], 'feed id'));
		case 'at':
			return at(args.length ? args : await downloadedIds());
		case 'export':
			return exportDay(need(args[0], 'feed id'));
		case 'query':
			return query(need(args[0], 'type'), args.slice(1));
		default:
			console.log(HELP);
	}
}

function need(v: string | undefined, what: string): string {
	if (!v) {
		console.error(`missing ${what}\n\n${HELP}`);
		process.exit(1);
	}
	return v;
}

async function feeds() {
	const have = new Set(await downloadedIds());
	for (const f of odptGtfsFeeds) {
		const ok = client.canAccess(f.access) ? 'ok  ' : 'need token';
		console.log(
			`${f.id.padEnd(14)} ${f.access.padEnd(10)} ${ok.padEnd(11)} ${have.has(f.id) ? '✓' : ' '} ${f.name}`
		);
	}
}

async function fetchFeeds() {
	await mkdir(GTFS_DIR, { recursive: true });
	if (opts.path) {
		const id = need(args[0], 'id for the downloaded file');
		return download(id, (opts.access ?? 'basic') as OdptAccess, opts.path, 'custom');
	}
	const ids = opts.all
		? odptGtfsFeeds.filter((f) => client.canAccess(f.access)).map((f) => f.id)
		: args;
	if (!ids.length) need(undefined, 'feed id (or --all)');
	for (const id of ids) {
		const feed = findOdptFeed(id);
		if (!feed) {
			console.error(`unknown feed ${id}; see \`pnpm odpt feeds\``);
			continue;
		}
		try {
			await download(feed.id, feed.access, feed.path, feed.license);
		} catch (e) {
			console.error(`${id}: ${(e as Error).message}`);
		}
	}
}

async function download(id: string, access: OdptAccess, path: string, license: string) {
	const file = await client.file(access, path);
	const gtfs = parseGtfsZip(file.bytes);
	const meta = {
		id,
		url: file.url,
		license,
		fetchedAt: new Date().toISOString(),
		lastModified: file.lastModified,
		etag: file.etag,
		sha256: createHash('sha256').update(file.bytes).digest('hex'),
		bytes: file.bytes.length,
		feedInfo: gtfs.feedInfo[0],
		counts: {
			stops: gtfs.stops.length,
			routes: gtfs.routes.length,
			trips: gtfs.trips.length,
			stopTimes: gtfs.stopTimes.length,
			shapes: gtfs.shapes.length
		}
	};
	await writeFile(join(GTFS_DIR, `${id}.zip`), file.bytes);
	await writeFile(join(GTFS_DIR, `${id}.json`), JSON.stringify(meta, null, '\t'));
	const v = meta.feedInfo;
	console.log(
		`${id}: ${(meta.bytes / 1e6).toFixed(1)} MB, ${meta.counts.trips} trips, ${meta.counts.stops} stops` +
			(v ? `, valid ${v.feed_start_date}–${v.feed_end_date} (version ${v.feed_version})` : '')
	);
}

async function downloadedIds(): Promise<string[]> {
	try {
		return (await readdir(GTFS_DIR)).filter((f) => f.endsWith('.zip')).map((f) => f.slice(0, -4));
	} catch {
		return [];
	}
}

async function load(id: string): Promise<Timetable> {
	let bytes: Buffer;
	try {
		bytes = await readFile(join(GTFS_DIR, `${id}.zip`));
	} catch {
		console.error(`${id} not downloaded; run \`pnpm odpt fetch ${id}\``);
		process.exit(1);
	}
	return buildTimetable(parseGtfsZip(new Uint8Array(bytes)), id);
}

function when() {
	const now = nowIn();
	const date = opts.date ?? now.date;
	const seconds = opts.time
		? parseGtfsTime(opts.time.length === 5 ? `${opts.time}:00` : opts.time)
		: now.seconds;
	return { date, seconds };
}

async function info(id: string) {
	const tt = await load(id);
	const { date } = when();
	const today = tripsOn(tt, date);
	console.log(`${id}: ${tt.agencies.map((a) => a.nameEn ?? a.name).join(', ')}`);
	console.log(`valid ${tt.validFrom ?? '?'}–${tt.validTo ?? '?'}, version ${tt.version ?? '?'}`);
	console.log(`${tt.stations.length} stops, ${tt.routes.length} routes, ${tt.trips.length} trips`);
	console.log(
		`services: ${[...tt.weekly.keys()].join(', ')}; ${tt.exceptions.size} exception dates`
	);
	console.log(`\n${date}: ${today.length} trips`);
	for (const [i, r] of tt.routes.entries()) {
		const trips = today.filter((t) => t.route === i);
		if (!trips.length) continue;
		const first = Math.min(...trips.map((t) => t.dep[0]));
		const last = Math.max(...trips.map((t) => t.arr[t.arr.length - 1]));
		console.log(
			`  ${r.name.padEnd(12)} ${(r.nameEn ?? '').padEnd(22)} ${r.color ?? '       '} ` +
				`${String(trips.length).padStart(5)} trips  ${formatGtfsTime(first)}–${formatGtfsTime(last)}`
		);
	}
}

async function at(ids: string[]) {
	const { date, seconds } = when();
	const limit = Number(opts.limit ?? 20);
	console.log(`${date} ${formatGtfsTime(seconds)}`);
	for (const id of ids) {
		const tt = await load(id);
		const pos = positionsAt(tt, date, seconds);
		console.log(`\n${id}: ${pos.length} trains running`);
		for (const p of pos.slice(0, limit)) {
			const r = tt.routes[p.trip.route];
			const from = tt.stations[p.from].name;
			const where = p.dwelling
				? `at ${from}`
				: `${from} → ${tt.stations[p.to].name} ${Math.round(p.progress * 100)}%`;
			console.log(
				`  ${r.name.padEnd(10)} ${p.trip.id.padEnd(14)} for ${p.trip.headsign.padEnd(10)} ${where.padEnd(24)} ` +
					`${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
			);
		}
		if (pos.length > limit) console.log(`  … ${pos.length - limit} more (--limit)`);
	}
}

/**
 * Compact one service day for the browser: stations, routes, and trips as
 * flat [stationIndex, arrival, departure, …] arrays in seconds since midnight.
 */
async function exportDay(id: string) {
	const tt = await load(id);
	const { date } = when();
	const trips = tripsOn(tt, date);
	const out = {
		feed: id,
		date,
		version: tt.version,
		stations: tt.stations.map((s) => ({
			id: s.id,
			code: s.code,
			name: s.name,
			nameEn: s.nameEn,
			lat: s.lat,
			lon: s.lon
		})),
		routes: tt.routes.map((r) => ({
			id: r.id,
			name: r.name,
			nameEn: r.nameEn,
			color: r.color,
			type: r.type
		})),
		trips: trips.map((t) => ({
			id: t.id,
			route: t.route,
			headsign: t.headsign,
			direction: t.directionId,
			block: t.blockId || undefined,
			stops: Array.from(t.stops).flatMap((s, i) => [s, t.arr[i], t.dep[i]])
		}))
	};
	const file = opts.out ?? join(DATA, 'timetable', `${id}-${date}.json`);
	await mkdir(join(file, '..'), { recursive: true });
	await writeFile(file, JSON.stringify(out));
	console.log(`${file}: ${out.trips.length} trips, ${out.stations.length} stations`);
}

async function query(type: string, kv: string[]) {
	const params = Object.fromEntries(
		kv.map((s) => {
			const i = s.indexOf('=');
			return [s.slice(0, i), s.slice(i + 1)];
		})
	);
	if (opts.operator) params['odpt:operator'] = `odpt.Operator:${opts.operator}`;
	const rows = await client.query(type, params, {
		access: (opts.access ?? 'basic') as OdptAccess,
		dump: opts.dump
	});
	const json = JSON.stringify(rows, null, '\t');
	if (opts.out) {
		await mkdir(join(opts.out, '..'), { recursive: true });
		await writeFile(opts.out, json);
		console.log(`${opts.out}: ${rows.length} objects`);
	} else console.log(json);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
