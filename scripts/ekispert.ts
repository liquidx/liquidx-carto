/**
 * 駅すぱあと API CLI. Run `pnpm ekispert help`.
 * The access key comes from .env: EKISPERT_API_KEY.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { EkispertClient, type CourseSearch } from '../src/lib/transit/ekispert/client.ts';
import {
	departures,
	shapeToGeoJSON,
	type EkiStation
} from '../src/lib/transit/ekispert/normalize.ts';

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		date: { type: 'string' },
		time: { type: 'string' },
		arrive: { type: 'boolean' },
		first: { type: 'boolean' },
		last: { type: 'boolean' },
		count: { type: 'string' },
		stops: { type: 'boolean' },
		shape: { type: 'boolean' },
		code: { type: 'string' },
		radius: { type: 'string' },
		type: { type: 'string' },
		json: { type: 'boolean' },
		out: { type: 'string' }
	}
});
const [command = 'help', ...args] = positionals;

const HELP = `usage: pnpm ekispert <command>

  station <name>                     station search (prefix match; not billed)
  near <lat> <lon> [--radius 500]    stations near a point
  route <from> [via…] <to> [--date YYYYMMDD] [--time HHMM] [--arrive|--first|--last]
        [--count 3] [--stops] [--shape [--out file.geojson]]
                                     timetable route search; names or station codes
  timetable <station> [--code N] [--date YYYYMMDD]
                                     list directions, or departures for one direction code
  train <code>                       stops for a train code from a timetable
  raw <path> [key=value…]            call any endpoint, prints the ResultSet
  version                            data version / check the key works

  add --json to most commands for the normalised JSON`;

const ekispert = () => new EkispertClient(process.env.EKISPERT_API_KEY ?? '');

async function main() {
	switch (command) {
		case 'station':
			return print(
				await ekispert().stationsByName(need(args[0], 'name'), { type: opts.type }),
				stationLine
			);
		case 'near':
			return print(
				await ekispert().stationsNear(
					Number(need(args[0], 'lat')),
					Number(need(args[1], 'lon')),
					Number(opts.radius ?? 500),
					opts.type ?? 'train'
				),
				stationLine
			);
		case 'route':
			return route();
		case 'timetable':
			return timetable(need(args[0], 'station'));
		case 'train':
			return train(need(args[0], 'train code'));
		case 'raw':
			return console.log(
				JSON.stringify(
					await ekispert().get(
						need(args[0], 'path'),
						Object.fromEntries(
							args.slice(1).map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)])
						)
					),
					null,
					'\t'
				)
			);
		case 'version':
			return console.log(JSON.stringify(await ekispert().dataVersion(), null, '\t'));
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

function print<T>(rows: T[], line: (r: T) => string) {
	if (opts.json) console.log(JSON.stringify(rows, null, '\t'));
	else for (const r of rows) console.log(line(r));
}

function stationLine(s: EkiStation) {
	const where = s.lat !== undefined ? ` ${s.lat.toFixed(5)},${s.lon!.toFixed(5)}` : '';
	const dist = s.distance !== undefined ? ` ${s.distance}m` : '';
	return `${s.code.padStart(6)}  ${s.name} (${s.yomi ?? ''}) ${s.type ?? ''}${s.typeDetail ? '/' + s.typeDetail : ''} ${s.prefecture ?? ''}${where}${dist}`;
}

const hhmm = (iso?: string) => (iso ? (iso.match(/T?(\d\d:\d\d)/)?.[1] ?? iso) : '--:--');

async function route() {
	if (args.length < 2) need(undefined, 'from and to');
	const searchType: CourseSearch['searchType'] = opts.arrive
		? 'arrival'
		: opts.first
			? 'firstTrain'
			: opts.last
				? 'lastTrain'
				: 'departure';
	const client = ekispert();
	const courses = await client.searchCourse({
		via: args,
		date: opts.date,
		time: opts.time?.replace(':', ''),
		searchType,
		answerCount: Number(opts.count ?? 3),
		addStop: opts.stops
	});
	if (opts.json) {
		console.log(JSON.stringify(courses, null, '\t'));
	} else {
		for (const [i, c] of courses.entries()) {
			const first = c.legs[0];
			const last = c.legs[c.legs.length - 1];
			const total = (c.minutesOnBoard ?? 0) + (c.minutesWalk ?? 0) + (c.minutesOther ?? 0);
			console.log(
				`\n#${i + 1}  ${hhmm(first?.departure)} → ${hhmm(last?.arrival)}  ${total} min, ` +
					`${c.transferCount} transfers, ¥${c.fare ?? '?'}, ${c.distanceKm ?? '?'} km`
			);
			for (const leg of c.legs) {
				const plat = leg.departurePlatform ? ` [${leg.departurePlatform}番線]` : '';
				console.log(`  ${hhmm(leg.departure)} ${leg.from.name}${plat}`);
				console.log(
					`      ${leg.name}${leg.destination ? ` for ${leg.destination}` : ''}${leg.color ? ` ${leg.color}` : ''}`
				);
				for (const s of leg.stops)
					console.log(`        ${hhmm(s.arrival ?? s.departure)} ${s.station.name}`);
				console.log(`  ${hhmm(leg.arrival)} ${leg.to.name}`);
			}
		}
	}
	if (opts.shape && courses[0]) {
		const geojson = shapeToGeoJSON(await client.courseShape(courses[0].serializeData));
		const file = opts.out ?? join(process.cwd(), 'data', 'ekispert', 'route.geojson');
		await mkdir(join(file, '..'), { recursive: true });
		await writeFile(file, JSON.stringify(geojson));
		console.log(`\nshape of #1 → ${file} (${geojson.features.length} lines)`);
	}
}

async function timetable(stationArg: string) {
	const tables = await ekispert().stationTimetable({
		station: stationArg,
		code: opts.code,
		date: opts.date
	});
	if (!opts.code) {
		if (opts.json) return console.log(JSON.stringify(tables, null, '\t'));
		for (const t of tables) {
			console.log(
				`${String(t.code).padStart(6)}  ${t.Line?.Name} for ${t.Line?.Direction} (${t.dateGroup}, ${t.trainCount} trains)`
			);
		}
		console.log('\nrerun with --code <code> for departures');
		return;
	}
	const deps = tables.flatMap(departures);
	print(
		deps,
		(d) =>
			`${d.time}  ${(d.kind ?? '').padEnd(6)} for ${d.destination ?? '?'}  [${d.platform ?? ''}] ${d.trainCode}`
	);
}

async function train(code: string) {
	const lines = await ekispert().trainStops(code);
	print(lines, (l) =>
		[l.name, ...l.stops.map((s) => `  ${hhmm(s.arrival ?? s.departure)}  ${s.station.name}`)].join(
			'\n'
		)
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
