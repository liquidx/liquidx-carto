import { asArray, course, shape, station, type Raw } from './normalize.ts';

const BASE = 'https://api.ekispert.jp/v1/json';

export class EkispertError extends Error {
	status: number;
	code?: string;
	constructor(status: number, message: string, code?: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

export type Params = Record<string, string | number | boolean | undefined>;

export type CourseSearch = {
	/** Station names or codes, first = origin, last = destination. */
	via: (string | number)[];
	/** YYYYMMDD, default today. */
	date?: string;
	/** HHMM, default now. */
	time?: string;
	/** departure | arrival | firstTrain | lastTrain | plain (average time, no timetable) */
	searchType?: 'departure' | 'arrival' | 'firstTrain' | 'lastTrain' | 'plain';
	sort?: 'ekispert' | 'price' | 'time' | 'transfer' | 'teiki' | 'co2';
	answerCount?: number;
	/** Include every intermediate stop with times (timetable searches only). */
	addStop?: boolean;
	/** Route only through these operators (会社名, e.g. "京王電鉄"). */
	corporations?: string[];
};

/**
 * Client for 駅すぱあと API (Ekispert Web Service v1).
 * Every call is a GET with the access key as a query parameter; coordinates are requested in WGS84.
 * Trial keys cover Hokkaido, Tokyo, Kanagawa and Osaka for station/rail/corporation lookups;
 * free-plan keys only get /station and /search/course/light.
 */
export class EkispertClient {
	private key: string;
	private fetchImpl: typeof fetch;

	constructor(key: string, fetchImpl: typeof fetch = fetch) {
		if (!key) throw new EkispertError(0, 'No Ekispert access key configured');
		this.key = key;
		this.fetchImpl = fetchImpl;
	}

	/** Raw call: `get('station/light', { name: '三鷹' })` → ResultSet. */
	async get(path: string, params: Params = {}): Promise<Raw> {
		const url = new URL(`${BASE}/${path.replace(/^\//, '')}`);
		url.searchParams.set('key', this.key);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
		}
		// Multi-value params are colon-separated and the API wants the colons unencoded.
		const href = url.href.replaceAll('%3A', ':');
		const res = await this.fetchImpl(href);
		const body = await res.text();
		let json: Raw;
		try {
			json = JSON.parse(body);
		} catch {
			throw new EkispertError(
				res.status,
				`Ekispert ${res.status} for /${path}: ${body.slice(0, 200)}`
			);
		}
		const err = json?.ResultSet?.Error;
		if (!res.ok || err) {
			const msg = err?.Message ?? body.slice(0, 200);
			throw new EkispertError(res.status, `Ekispert ${res.status} for /${path}: ${msg}`, err?.code);
		}
		return json.ResultSet;
	}

	/** Station name autocomplete (not billed). */
	async stationsByName(
		name: string,
		opts: { type?: string; partial?: boolean; prefecture?: string } = {}
	) {
		const rs = await this.get('station/light', {
			name,
			type: opts.type,
			nameMatchType: opts.partial ? 'partial' : undefined,
			prefectureCode: opts.prefecture
		});
		return asArray(rs.Point).map(station);
	}

	/** Full station details including coordinates. */
	async stations(params: {
		name?: string;
		code?: string | number;
		type?: string;
		prefecture?: string;
	}) {
		const rs = await this.get('station', {
			name: params.name,
			code: params.code,
			type: params.type,
			prefectureCode: params.prefecture,
			gcs: 'wgs84'
		});
		return asArray(rs.Point).map(station);
	}

	/** Stations near a point; radius in metres. */
	async stationsNear(lat: number, lon: number, radius = 500, type = 'train') {
		const rs = await this.get('geo/station', {
			geoPoint: `${lat},${lon},wgs84,${radius}`,
			type,
			gcs: 'wgs84'
		});
		return asArray(rs.Point).map(station);
	}

	/** Route search using timetables (経路探索 /search/course/extreme). */
	async searchCourse(q: CourseSearch) {
		const rs = await this.get('search/course/extreme', {
			viaList: q.via.join(':'),
			date: q.date,
			time: q.time,
			searchType: q.searchType,
			sort: q.sort,
			answerCount: q.answerCount,
			addStop: q.addStop ? 'true' : undefined,
			corporationBind: q.corporations?.join(':'),
			resultDetail: 'addCorporation',
			gcs: 'wgs84'
		});
		return asArray(rs.Course).map(course);
	}

	/** Track-following polylines for a searched course. */
	async courseShape(serializeData: string, type: 'train' | 'all' = 'all') {
		const rs = await this.get('course/shape', { serializeData, type, gcs: 'wgs84' });
		return shape(rs);
	}

	/**
	 * Station timetable. Without `code`, returns the list of directions (方面) with their codes;
	 * with `code`, returns the full timetable for that direction.
	 */
	async stationTimetable(params: {
		station: string | number;
		code?: string | number;
		date?: string;
	}) {
		const isCode = /^\d+$/.test(String(params.station));
		const rs = await this.get('operationLine/timetable', {
			stationCode: isCode ? params.station : undefined,
			stationName: isCode ? undefined : params.station,
			code: params.code,
			date: params.date
		});
		return asArray(rs.TimeTable);
	}

	/** Stops and times for one train from a station timetable (列車等を特定するコード). */
	async trainStops(code: string | number) {
		const rs = await this.get('station/timetable/train', { code });
		return asArray(rs.Line).map((line: Raw) => ({
			name: line.Name as string,
			stops: asArray(line.Stop).map((s: Raw) => ({
				station: station(s.Point ?? {}),
				arrival: s.ArrivalState?.Datetime?.text as string | undefined,
				departure: s.DepartureState?.Datetime?.text as string | undefined
			}))
		}));
	}

	/** Operation lines (運行路線), filterable by name prefix. */
	async operationLines(params: Params = {}) {
		const rs = await this.get('operationLine', params);
		return asArray(rs.OperationLine);
	}

	async dataVersion() {
		return this.get('dataversion');
	}
}
