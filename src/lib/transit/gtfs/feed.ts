import { unzipSync, strFromU8 } from 'fflate';
import { parseCsv } from './csv.ts';

type Row = Record<string, string>;

/** Raw GTFS / GTFS-JP tables, as parsed from a feed zip. Missing optional files are empty arrays. */
export type GtfsFeed = {
	agency: Row[];
	stops: Row[];
	routes: Row[];
	trips: Row[];
	stopTimes: Row[];
	calendar: Row[];
	calendarDates: Row[];
	shapes: Row[];
	translations: Row[];
	feedInfo: Row[];
	/** Any other .txt files in the zip, keyed by file name without extension. */
	extra: Record<string, Row[]>;
};

const KNOWN: Record<string, keyof Omit<GtfsFeed, 'extra'>> = {
	agency: 'agency',
	stops: 'stops',
	routes: 'routes',
	trips: 'trips',
	stop_times: 'stopTimes',
	calendar: 'calendar',
	calendar_dates: 'calendarDates',
	shapes: 'shapes',
	translations: 'translations',
	feed_info: 'feedInfo'
};

/** Parse a GTFS zip. Files nested in a single top-level folder are also accepted. */
export function parseGtfsZip(bytes: Uint8Array): GtfsFeed {
	const files = unzipSync(bytes, { filter: (f) => f.name.endsWith('.txt') });
	const feed: GtfsFeed = {
		agency: [],
		stops: [],
		routes: [],
		trips: [],
		stopTimes: [],
		calendar: [],
		calendarDates: [],
		shapes: [],
		translations: [],
		feedInfo: [],
		extra: {}
	};
	for (const [path, data] of Object.entries(files)) {
		const name = path
			.split('/')
			.pop()!
			.replace(/\.txt$/, '');
		const rows = parseCsv(strFromU8(data));
		const key = KNOWN[name];
		if (key) feed[key] = rows;
		else feed.extra[name] = rows;
	}
	return feed;
}

/**
 * Build a translator for GTFS / GTFS-JP `translations.txt`.
 * Supports both the field_value form (GTFS-JP) and the record_id form (GTFS spec).
 */
export function translator(feed: GtfsFeed, language: string) {
	const byValue = new Map<string, string>();
	const byRecord = new Map<string, string>();
	for (const t of feed.translations) {
		if (t.language !== language) continue;
		const table = t.table_name;
		const field = t.field_name;
		if (t.record_id) byRecord.set(`${table}|${field}|${t.record_id}`, t.translation);
		else if (t.field_value) byValue.set(`${table}|${field}|${t.field_value}`, t.translation);
	}
	return (table: string, field: string, value: string, recordId?: string): string | undefined =>
		(recordId && byRecord.get(`${table}|${field}|${recordId}`)) ||
		byValue.get(`${table}|${field}|${value}`);
}
