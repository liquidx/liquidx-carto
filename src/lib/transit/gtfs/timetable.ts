import { translator, type GtfsFeed } from './feed.ts';
import { addDays, dayOfWeek, parseGtfsTime } from './time.ts';

export type Station = {
	id: string;
	/** Station number as shown on signage, e.g. "A-01" (GTFS stop_code). */
	code: string;
	name: string;
	nameEn?: string;
	lat: number;
	lon: number;
	parentId?: string;
};

export type Route = {
	id: string;
	agencyId: string;
	name: string;
	nameEn?: string;
	/** "#rrggbb", or undefined when the feed has no colour. */
	color?: string;
	textColor?: string;
	/** GTFS route_type: 0 tram, 1 subway, 2 rail, 3 bus, 12 monorail … */
	type: number;
};

export type Trip = {
	id: string;
	route: number;
	serviceId: string;
	headsign: string;
	directionId: number;
	blockId: string;
	/** Station index per stop, in stop_sequence order. */
	stops: Int32Array;
	/** Arrival / departure in seconds since service-day midnight (may exceed 86400). */
	arr: Int32Array;
	dep: Int32Array;
};

type WeeklyService = { days: boolean[]; start: string; end: string };

/** A compact, query-friendly view of one GTFS feed. */
export type Timetable = {
	feedId: string;
	agencies: { id: string; name: string; nameEn?: string; timezone: string }[];
	validFrom?: string;
	validTo?: string;
	version?: string;
	stations: Station[];
	routes: Route[];
	trips: Trip[];
	weekly: Map<string, WeeklyService>;
	/** date → serviceId → 1 (added) | 2 (removed) */
	exceptions: Map<string, Map<string, number>>;
};

const hex = (c: string | undefined) =>
	c && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toUpperCase()}` : undefined;

export function buildTimetable(feed: GtfsFeed, feedId = 'gtfs'): Timetable {
	const en = translator(feed, 'en');

	const stations: Station[] = [];
	const stationIndex = new Map<string, number>();
	for (const s of feed.stops) {
		stationIndex.set(s.stop_id, stations.length);
		stations.push({
			id: s.stop_id,
			code: s.stop_code ?? '',
			name: s.stop_name,
			nameEn: en('stops', 'stop_name', s.stop_name, s.stop_id),
			lat: Number(s.stop_lat),
			lon: Number(s.stop_lon),
			parentId: s.parent_station || undefined
		});
	}

	const routes: Route[] = [];
	const routeIndex = new Map<string, number>();
	for (const r of feed.routes) {
		const name = r.route_long_name || r.route_short_name;
		routeIndex.set(r.route_id, routes.length);
		routes.push({
			id: r.route_id,
			agencyId: r.agency_id,
			name,
			nameEn:
				en('routes', 'route_long_name', r.route_long_name, r.route_id) ??
				en('routes', 'route_short_name', r.route_short_name, r.route_id),
			color: hex(r.route_color),
			textColor: hex(r.route_text_color),
			type: Number(r.route_type)
		});
	}

	// Group stop_times by trip, then sort by stop_sequence.
	const byTrip = new Map<string, { seq: number; stop: number; arr: number; dep: number }[]>();
	for (const st of feed.stopTimes) {
		const stop = stationIndex.get(st.stop_id);
		if (stop === undefined) continue;
		const arr = parseGtfsTime(st.arrival_time || st.departure_time);
		const dep = parseGtfsTime(st.departure_time || st.arrival_time);
		let list = byTrip.get(st.trip_id);
		if (!list) byTrip.set(st.trip_id, (list = []));
		list.push({ seq: Number(st.stop_sequence), stop, arr, dep });
	}

	const trips: Trip[] = [];
	for (const t of feed.trips) {
		const list = byTrip.get(t.trip_id);
		const route = routeIndex.get(t.route_id);
		if (!list || list.length < 2 || route === undefined) continue;
		list.sort((a, b) => a.seq - b.seq);
		// Untimed intermediate stops (blank times) are dropped; positions interpolate across them.
		const timed = list.filter((s) => Number.isFinite(s.arr) && Number.isFinite(s.dep));
		if (timed.length < 2) continue;
		trips.push({
			id: t.trip_id,
			route,
			serviceId: t.service_id,
			headsign: t.trip_headsign ?? '',
			directionId: Number(t.direction_id || 0),
			blockId: t.block_id ?? '',
			stops: Int32Array.from(timed, (s) => s.stop),
			arr: Int32Array.from(timed, (s) => s.arr),
			dep: Int32Array.from(timed, (s) => s.dep)
		});
	}
	trips.sort((a, b) => a.dep[0] - b.dep[0]);

	const weekly = new Map<string, WeeklyService>();
	for (const c of feed.calendar) {
		weekly.set(c.service_id, {
			days: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(
				(d) => c[d] === '1'
			),
			start: c.start_date,
			end: c.end_date
		});
	}
	const exceptions = new Map<string, Map<string, number>>();
	for (const cd of feed.calendarDates) {
		let day = exceptions.get(cd.date);
		if (!day) exceptions.set(cd.date, (day = new Map()));
		day.set(cd.service_id, Number(cd.exception_type));
	}

	const info = feed.feedInfo[0];
	return {
		feedId,
		agencies: feed.agency.map((a) => ({
			id: a.agency_id,
			name: a.agency_name,
			nameEn: en('agency', 'agency_name', a.agency_name, a.agency_id),
			timezone: a.agency_timezone
		})),
		validFrom: info?.feed_start_date || undefined,
		validTo: info?.feed_end_date || undefined,
		version: info?.feed_version || undefined,
		stations,
		routes,
		trips,
		weekly,
		exceptions
	};
}

/** Service IDs running on a date ("YYYYMMDD"), applying calendar_dates exceptions. */
export function activeServices(tt: Timetable, date: string): Set<string> {
	const dow = dayOfWeek(date);
	const active = new Set<string>();
	for (const [id, w] of tt.weekly) {
		if (w.days[dow] && date >= w.start && date <= w.end) active.add(id);
	}
	for (const [id, type] of tt.exceptions.get(date) ?? []) {
		if (type === 1) active.add(id);
		else if (type === 2) active.delete(id);
	}
	return active;
}

export function tripsOn(tt: Timetable, date: string): Trip[] {
	const active = activeServices(tt, date);
	return tt.trips.filter((t) => active.has(t.serviceId));
}

export type TrainPosition = {
	trip: Trip;
	/** Service date the trip belongs to (may be the previous day after midnight). */
	serviceDate: string;
	lat: number;
	lon: number;
	/** Station index the train is at (dwelling) or last departed. */
	from: number;
	/** Next station index; equal to `from` while dwelling. */
	to: number;
	/** 0..1 along the from→to segment. */
	progress: number;
	dwelling: boolean;
};

/**
 * Where every train is at a moment in time, interpolating linearly between stations.
 * `seconds` is local time since midnight on `date`; trips from the previous service
 * day that run past midnight (GTFS times ≥ 24:00) are included.
 */
export function positionsAt(tt: Timetable, date: string, seconds: number): TrainPosition[] {
	const out: TrainPosition[] = [];
	const days: [string, number][] = [
		[date, seconds],
		[addDays(date, -1), seconds + 86400]
	];
	for (const [serviceDate, t] of days) {
		const active = activeServices(tt, serviceDate);
		for (const trip of tt.trips) {
			if (trip.dep[0] > t) break; // trips are sorted by first departure
			if (!active.has(trip.serviceId)) continue;
			const pos = tripPosition(tt, trip, t);
			if (pos) out.push({ ...pos, trip, serviceDate });
		}
	}
	return out;
}

/** Position of one trip at service-day time `t`, or null if it isn't running. */
export function tripPosition(
	tt: Timetable,
	trip: Trip,
	t: number
): Omit<TrainPosition, 'trip' | 'serviceDate'> | null {
	const n = trip.stops.length;
	if (t < trip.dep[0] || t > trip.arr[n - 1]) return null;
	// Last stop index i with arr[i] <= t.
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (trip.arr[mid] <= t) lo = mid;
		else hi = mid - 1;
	}
	const i = lo;
	const a = tt.stations[trip.stops[i]];
	if (t <= trip.dep[i] || i === n - 1) {
		return {
			lat: a.lat,
			lon: a.lon,
			from: trip.stops[i],
			to: trip.stops[i],
			progress: 0,
			dwelling: true
		};
	}
	const b = tt.stations[trip.stops[i + 1]];
	const span = trip.arr[i + 1] - trip.dep[i];
	const p = span > 0 ? (t - trip.dep[i]) / span : 1;
	return {
		lat: a.lat + (b.lat - a.lat) * p,
		lon: a.lon + (b.lon - a.lon) * p,
		from: trip.stops[i],
		to: trip.stops[i + 1],
		progress: p,
		dwelling: false
	};
}
