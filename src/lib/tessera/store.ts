/**
 * Tessera embeddings read straight from the public Zarr stores, in the browser or in Node: the
 * releases geotessera's `GeoTesseraZarr` reads, from the same bucket, so a pixel here is the
 * pixel the Python library sees. Each release is its own model, so its embeddings are only
 * comparable with its own.
 *
 * The store holds one group per UTM zone (`utm54`), each a 10 m grid in that zone's northern
 * CRS (southern rows have negative northings), with `embeddings` as int8 (year, band, y, x) and
 * a float32 `scales` (year, y, x) that turns them back into the model's floats. The classifier
 * only looks at which way each embedding points, which the scale doesn't change, so `scales` is
 * read only for where there is data: NaN is water, +inf land not filled yet.
 */
import proj4 from 'proj4';
import * as zarr from 'zarrita';
import type { Position } from 'geojson';

const BUCKET =
	'https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/tessera/tessera/zarr/';
/** The releases, by the names geotessera's `zarr_store_url` takes. */
export const TESSERA_RELEASES = {
	v1: { label: '1.0', path: 'v1' },
	'v1.1': { label: '1.1', path: 'v1.1-dclimate' },
	v2: { label: '2 beta', path: 'v2-2B-L~beta1' }
} as const;
export type TesseraVersion = keyof typeof TESSERA_RELEASES;
/** The release geotessera recommends. */
export const DEFAULT_VERSION: TesseraVersion = 'v1.1';
export const isVersion = (v: unknown): v is TesseraVersion =>
	typeof v === 'string' && v in TESSERA_RELEASES;
export const BANDS = 128;
/** Metres per pixel. */
export const PIXEL = 10;
/** Scales above this are nodata, as geotessera's `valid_scale_mask` has it. */
const MAX_VALID_SCALE = 1;
/** Rows read at a time: four rows of the store's 32 px chunks. */
const STRIP = 128;

export type Box = [west: number, south: number, east: number, north: number];

/** Somewhere to keep the bytes of chunks read before: memory, the Cache API or files. */
export interface ByteCache {
	get(key: string): Promise<Uint8Array | undefined>;
	set(key: string, bytes: Uint8Array): Promise<void>;
}

/** A block of pixels on one zone's grid. */
export interface Region {
	width: number;
	height: number;
	zone: number;
	/** Easting and northing of the top left corner of the top left pixel. */
	left: number;
	top: number;
	/** Band b of pixel i (row by row from the top) is at `b * width * height + i`. */
	embeddings: Int8Array;
	/** 1 where the pixel has an embedding. */
	valid: Uint8Array;
}

export const zoneOf = (lon: number) => Math.min(60, Math.floor((lon + 180) / 6) + 1);

const projections = new Map<number, proj4.Converter>();
/** Lon/lat to and from a zone's easting and northing. */
export function utm(zone: number) {
	let p = projections.get(zone);
	if (!p) {
		p = proj4('EPSG:4326', `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
		projections.set(zone, p);
	}
	return p;
}

/** A region's pixel coordinates (x right, y down, pixel (c, r) spans c…c+1, r…r+1) to lon/lat. */
export function pixelToLonLat(region: Region, [u, v]: Position): Position {
	const [lon, lat] = utm(region.zone).inverse([region.left + u * PIXEL, region.top - v * PIXEL]);
	return [lon, lat];
}

export function lonLatToPixel(region: Region, lonlat: Position): Position {
	const [x, y] = utm(region.zone).forward([lonlat[0], lonlat[1]]);
	return [(x - region.left) / PIXEL, (region.top - y) / PIXEL];
}

/** Ranged reads (chunks and shard indexes, which don't change) go through the cache. */
function cachingFetch(cache: ByteCache) {
	return async (request: Request) => {
		const range = request.headers.get('range');
		if (!range) return fetch(request);
		const key = `${request.url} ${range}`;
		const hit = await cache.get(key);
		if (hit) return new Response(hit as Uint8Array<ArrayBuffer>, { status: 206 });
		const response = await fetch(request);
		if (!response.ok) return response;
		const bytes = new Uint8Array(await response.arrayBuffer());
		await cache.set(key, bytes);
		return new Response(bytes, { status: response.status });
	};
}

/** The chunks read in this browser, kept by the Cache API between visits. */
export function browserCache(name = 'tessera'): ByteCache | undefined {
	if (typeof caches === 'undefined') return;
	const url = (key: string) => `https://${name}.cache/${encodeURIComponent(key)}`;
	return {
		async get(key) {
			try {
				const hit = await (await caches.open(name)).match(url(key));
				return hit ? new Uint8Array(await hit.arrayBuffer()) : undefined;
			} catch {
				return undefined;
			}
		},
		async set(key, bytes) {
			try {
				await (
					await caches.open(name)
				).put(url(key), new Response(bytes as Uint8Array<ArrayBuffer>));
			} catch {
				// Full or blocked storage: the read still goes through, just not kept.
			}
		}
	};
}

interface Zone {
	embeddings: zarr.Array<'int8', zarr.Readable>;
	scales: zarr.Array<'float32', zarr.Readable>;
	years: number[];
	left: number;
	top: number;
	rows: number;
	cols: number;
}

export class TesseraStore {
	readonly version: TesseraVersion;
	readonly url: string;
	private root: zarr.Location<zarr.Readable>;
	private zones = new Map<number, Promise<Zone>>();

	constructor(opts: { version?: TesseraVersion; cache?: ByteCache } = {}) {
		this.version = opts.version ?? DEFAULT_VERSION;
		this.url = BUCKET + TESSERA_RELEASES[this.version].path;
		// Neighbouring chunks of a shard are read as one request: a browser has only a few
		// connections to a host, and each chunk alone is a round trip across the Pacific.
		const store = zarr.withRangeCoalescing(
			new zarr.FetchStore(this.url, {
				useSuffixRequest: true,
				fetch: opts.cache ? cachingFetch(opts.cache) : undefined
			})
		);
		this.root = zarr.root(store);
	}

	/** A zone's arrays, opened once: zarrita keeps the shard indexes it has read on them. */
	private zone(zone: number) {
		let z = this.zones.get(zone);
		if (!z) {
			const group = this.root.resolve(`utm${String(zone).padStart(2, '0')}`);
			const open = (name: string) => zarr.open(group.resolve(name), { kind: 'array' });
			z = (async () => {
				const [embeddings, scales, time, x, y] = await Promise.all(
					['embeddings', 'scales', 'time', 'x', 'y'].map(open)
				);
				if (!embeddings.is('int8') || !scales.is('float32'))
					throw new Error(`utm${zone}: unexpected embedding types`);
				const first = async (a: zarr.Array<zarr.DataType, zarr.Readable>) =>
					Number(((await zarr.get(a, [zarr.slice(0, 1)])).data as Float64Array)[0]);
				const [x0, y0] = await Promise.all([first(x), first(y)]);
				const years = Array.from((await zarr.get(time)).data as Int32Array, Number);
				// x and y are pixel centres.
				const [, , rows, cols] = embeddings.shape;
				return { embeddings, scales, years, left: x0 - PIXEL / 2, top: y0 + PIXEL / 2, rows, cols };
			})();
			z.catch(() => this.zones.delete(zone));
			this.zones.set(zone, z);
		}
		return z;
	}

	/** The years a box's zone has embeddings for, somewhere. */
	async years(box: Box) {
		return (await this.zone(zoneOf((box[0] + box[2]) / 2))).years;
	}

	/**
	 * The years with embeddings at a box's middle: a release is filled in a year at a time,
	 * so most years of a zone can be empty in one place.
	 */
	async coverage(box: Box) {
		const lon = (box[0] + box[2]) / 2;
		const lat = (box[1] + box[3]) / 2;
		const zone = zoneOf(lon);
		const z = await this.zone(zone);
		const [x, y] = utm(zone).forward([lon, lat]);
		const col = Math.floor((x - z.left) / PIXEL);
		const row = Math.floor((z.top - y) / PIXEL);
		if (col < 0 || row < 0 || col >= z.cols || row >= z.rows) return [];
		// One pixel of the scales says whether there's an embedding, at a 30th of the cost.
		const scales = await Promise.all(
			z.years.map(async (_, t) => (await zarr.get(z.scales, [t, row, col])) as number)
		);
		return z.years.filter((_, t) => scales[t] > 0 && scales[t] < MAX_VALID_SCALE);
	}

	/**
	 * Every pixel touching a lon/lat box, on the grid of the zone its middle is in (a box
	 * across a zone line reads past it on the one grid, as far as the store's zone extends).
	 */
	async read(box: Box, year: number, onprogress?: (done: number, total: number) => void) {
		const zone = zoneOf((box[0] + box[2]) / 2);
		const z = await this.zone(zone);
		const t = z.years.indexOf(year);
		if (t < 0) throw new Error(`no ${year} embeddings: the store has ${z.years.join(', ')}`);

		// The box's edges curve on the grid, so its extent comes from points along them.
		const [w, s, e, n] = box;
		const p = utm(zone);
		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity,
			maxY = -Infinity;
		for (let k = 0; k <= 8; k++) {
			const f = k / 8;
			for (const [lon, lat] of [
				[w + (e - w) * f, s],
				[w + (e - w) * f, n],
				[w, s + (n - s) * f],
				[e, s + (n - s) * f]
			]) {
				const [x, y] = p.forward([lon, lat]);
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
			}
		}
		const col0 = Math.max(0, Math.floor((minX - z.left) / PIXEL));
		const col1 = Math.min(z.cols, Math.ceil((maxX - z.left) / PIXEL));
		const row0 = Math.max(0, Math.floor((z.top - maxY) / PIXEL));
		const row1 = Math.min(z.rows, Math.ceil((z.top - minY) / PIXEL));
		const width = Math.max(0, col1 - col0);
		const height = Math.max(0, row1 - row0);
		const n2 = width * height;
		const region: Region = {
			width,
			height,
			zone,
			left: z.left + col0 * PIXEL,
			top: z.top - row0 * PIXEL,
			embeddings: new Int8Array(BANDS * n2),
			valid: new Uint8Array(n2)
		};
		if (!n2) return region;

		const cols = zarr.slice(col0, col1);
		for (let r = row0; r < row1;) {
			// Strips end on chunk rows, so no chunk is read twice.
			const end = Math.min(row1, (Math.floor(r / STRIP) + 1) * STRIP);
			const rows = zarr.slice(r, end);
			const [emb, sc] = await Promise.all([
				zarr.get(z.embeddings, [t, null, rows, cols]),
				zarr.get(z.scales, [t, rows, cols])
			]);
			const at = (r - row0) * width;
			const strip = (end - r) * width;
			for (let b = 0; b < BANDS; b++)
				region.embeddings.set(emb.data.subarray(b * strip, (b + 1) * strip), b * n2 + at);
			for (let i = 0; i < strip; i++) {
				const scale = sc.data[i];
				region.valid[at + i] = scale > 0 && scale < MAX_VALID_SCALE ? 1 : 0;
			}
			r = end;
			onprogress?.(r - row0, height);
		}
		return region;
	}
}
