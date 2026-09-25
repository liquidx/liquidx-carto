/**
 * Helpers to turn 駅すぱあと API JSON into predictable shapes.
 * The API returns a single object where there's one element and an array where
 * there are several, omits empty keys, and encodes every value as a string.
 */

// The raw JSON is loosely typed by nature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

export function asArray<T = Raw>(v: T | T[] | undefined | null): T[] {
	if (v === undefined || v === null) return [];
	return Array.isArray(v) ? v : [v];
}

/** Elements like `Type` are either "train" or { text: "bus", detail: "local" }. */
export function text(v: Raw): string | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v === 'object') return v.text;
	return String(v);
}

export function num(v: Raw): number | undefined {
	const s = text(v);
	if (s === undefined || s === '') return undefined;
	const n = Number(s);
	return Number.isFinite(n) ? n : undefined;
}

/** Ekispert colours are "RRRGGGBBB" in decimal, e.g. "255090035" → "#FF5A23". */
export function color(v: Raw): string | undefined {
	const s = text(v);
	if (!s || !/^\d{9}$/.test(s)) return undefined;
	const hex = [0, 3, 6].map((i) =>
		Number(s.slice(i, i + 3))
			.toString(16)
			.padStart(2, '0')
	);
	return `#${hex.join('').toUpperCase()}`;
}

export type EkiStation = {
	code: string;
	name: string;
	yomi?: string;
	/** train, plane, ship, bus, walk … */
	type?: string;
	typeDetail?: string;
	prefecture?: string;
	lat?: number;
	lon?: number;
	/** Distance in metres from the query point (geo/station). */
	distance?: number;
};

export function station(point: Raw): EkiStation {
	const s = point.Station ?? {};
	const geo = point.GeoPoint ?? s.GeoPoint;
	return {
		code: String(s.code ?? ''),
		name: s.Name,
		yomi: s.Yomi,
		type: text(s.Type),
		typeDetail: typeof s.Type === 'object' ? s.Type.detail : undefined,
		prefecture: point.Prefecture?.Name,
		lat: num(geo?.lati_d),
		lon: num(geo?.longi_d),
		distance: num(point.Distance)
	};
}

export type EkiStop = {
	station: EkiStation;
	arrival?: string;
	departure?: string;
};

export type EkiLeg = {
	name: string;
	type?: string;
	typeDetail?: string;
	trainId?: string;
	destination?: string;
	color?: string;
	lineSymbol?: string;
	from: EkiStation;
	to: EkiStation;
	/** ISO datetime (dia searches) or undefined (average-time searches). */
	departure?: string;
	arrival?: string;
	departurePlatform?: string;
	arrivalPlatform?: string;
	minutes?: number;
	stopCount?: number;
	/** Intermediate stops, present when searched with addStop=true. */
	stops: EkiStop[];
};

export type EkiCourse = {
	serializeData: string;
	/** onTimetable (timetable search) or others for average-time searches. */
	dataType?: string;
	minutesOnBoard?: number;
	minutesWalk?: number;
	minutesOther?: number;
	transferCount?: number;
	/** Kilometres. */
	distanceKm?: number;
	fare?: number;
	teiki1?: number;
	legs: EkiLeg[];
};

function datetime(state: Raw): string | undefined {
	return text(state?.Datetime);
}

export function course(c: Raw): EkiCourse {
	const route = c.Route ?? {};
	const points = asArray(route.Point).map(station);
	const lines = asArray(route.Line);
	const prices = asArray(c.Price);
	const price = (kind: string) => num(prices.find((p: Raw) => p.kind === kind)?.Oneway);
	const distance = num(route.distance);
	return {
		serializeData: c.SerializeData,
		dataType: c.dataType,
		minutesOnBoard: num(route.timeOnBoard),
		minutesWalk: num(route.timeWalk),
		minutesOther: num(route.timeOther),
		transferCount: num(route.transferCount),
		distanceKm: distance === undefined ? undefined : distance / 10,
		fare: price('FareSummary'),
		teiki1: price('Teiki1Summary'),
		legs: lines.map((line: Raw, i: number) => ({
			name: line.Name,
			type: text(line.Type),
			typeDetail: typeof line.Type === 'object' ? line.Type.detail : undefined,
			trainId: line.trainID,
			destination: line.Destination,
			color: color(line.Color),
			lineSymbol: line.LineSymbol?.Name,
			from: points[i],
			to: points[i + 1],
			departure: datetime(line.DepartureState),
			arrival: datetime(line.ArrivalState),
			departurePlatform: line.DepartureState?.no,
			arrivalPlatform: line.ArrivalState?.no,
			minutes: num(line.timeOnBoard),
			stopCount: num(line.stopStationCount),
			stops: asArray(line.Stop).map((s: Raw) => ({
				station: station(s.Point ?? {}),
				arrival: datetime(s.ArrivalState),
				departure: datetime(s.DepartureState)
			}))
		}))
	};
}

export type EkiDeparture = {
	/** "HH:MM" */
	time: string;
	kind?: string;
	destination?: string;
	trainName?: string;
	platform?: string;
	/** Pass to `trainStops()` to get this train's stops. */
	trainCode: string;
};

/** Flatten one direction's station timetable (operationLine/timetable with code) into departures. */
export function departures(tt: Raw): EkiDeparture[] {
	const lookup = (v: Raw) => new Map(asArray(v).map((e: Raw) => [String(e.code), text(e)]));
	const kinds = lookup(tt.LineKind);
	const dests = lookup(tt.LineDestination);
	const names = lookup(tt.LineName);
	return asArray(tt.HourTable).flatMap((h: Raw) =>
		asArray(h.MinuteTable).flatMap((m: Raw) =>
			asArray(m.Stop).map((s: Raw) => ({
				time: `${String(h.Hour).padStart(2, '0')}:${String(m.Minute).padStart(2, '0')}`,
				kind: kinds.get(String(s.kindCode)),
				destination: dests.get(String(s.destinationCode)),
				trainName: names.get(String(s.nameCode)),
				platform: s.platformNo,
				trainCode: String(s.lineCode)
			}))
		)
	);
}

export type EkiShapeLine = {
	name: string;
	type?: string;
	color?: string;
	direction?: string;
	/** [lon, lat] pairs, GeoJSON order. */
	coordinates: [number, number][];
	stations: EkiStation[];
};

export function shape(resultSet: Raw): EkiShapeLine[] {
	return asArray(resultSet.Course).flatMap((c: Raw) =>
		asArray(c.OperationLinePattern).map((p: Raw) => ({
			name: p.Line?.Name,
			type: text(p.Line?.Type),
			color: color(p.Line?.Color),
			direction: p.Line?.direction,
			coordinates: asArray(p.Line?.Shape)
				.map((s: Raw) => [num(s.GeoPoint?.longi_d), num(s.GeoPoint?.lati_d)])
				.filter((c): c is [number, number] => c[0] !== undefined && c[1] !== undefined),
			stations: asArray(p.Point).map(station)
		}))
	);
}

/** GeoJSON FeatureCollection of a course shape, for dropping straight into MapLibre. */
export function shapeToGeoJSON(lines: EkiShapeLine[]) {
	return {
		type: 'FeatureCollection' as const,
		features: lines.map((l) => ({
			type: 'Feature' as const,
			properties: { name: l.name, type: l.type, color: l.color, direction: l.direction },
			geometry: { type: 'LineString' as const, coordinates: l.coordinates }
		}))
	};
}
