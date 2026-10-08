/**
 * Elevation from public XYZ terrain tile services. All of these are free, need no API key and
 * send `Access-Control-Allow-Origin: *`, so tiles can be decoded in the browser.
 */
import type { Grid } from './contour.js';
import { metresPerUnit, yToLat, type MercatorBox } from './mercator.js';

export type Encoding = 'terrarium' | 'gsi';

export interface TerrainProvider {
	id: string;
	label: string;
	/** Short human description of coverage and resolution. */
	coverage: string;
	encoding: Encoding;
	minZoom: number;
	maxZoom: number;
	/** Pixel width of a tile. A 512 px tile has the detail of the next zoom up at 256 px. */
	tileSize: number;
	/** Fill nodata inside a tile from its parent, for layers that only partly cover a tile. */
	fillGaps?: boolean;
	url: (z: number, x: number, y: number) => string;
	attribution: string;
}

export const PROVIDERS: TerrainProvider[] = [
	{
		id: 'aws-terrarium',
		label: 'aws terrain tiles',
		coverage: 'global · srtm / gmted / ned, ~30 m (3 m in parts of the us)',
		encoding: 'terrarium',
		minZoom: 0,
		maxZoom: 15,
		tileSize: 256,
		url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
		attribution: 'Terrain Tiles · Mapzen / Tilezen, AWS Open Data'
	},
	{
		id: 'mapterhorn',
		label: 'mapterhorn',
		coverage: 'global · copernicus glo-30 plus national lidar where published',
		encoding: 'terrarium',
		minZoom: 0,
		// High zooms only exist where high-resolution sources do, and missing tiles fall back to
		// their parent.
		maxZoom: 16,
		tileSize: 512,
		url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
		attribution: '© Mapterhorn'
	},
	{
		id: 'reearth',
		label: 're:earth terrain',
		coverage: 'global · mapterhorn merged with the egm2008 geoid, ~5 m at best',
		encoding: 'terrarium',
		minZoom: 0,
		// The service answers deeper zooms too, but only by upsampling z14.
		maxZoom: 14,
		tileSize: 512,
		// `elevation` is height above sea level; the service also has an `ellipsoid` datum.
		url: (z, x, y) => `https://terrain.reearth.land/terrarium/elevation/${z}/${x}/${y}.png`,
		attribution: 'Re:Earth Terrain · Mapterhorn (CC BY 4.0)'
	},
	{
		id: 'gsi',
		label: 'gsi japan',
		coverage: 'japan only · dem10b, dem5a where surveyed',
		encoding: 'gsi',
		minZoom: 0,
		maxZoom: 15,
		tileSize: 256,
		url: (z, x, y) =>
			z >= 15
				? `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`
				: `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`,
		attribution: '国土地理院 (GSI Japan) 標高タイル'
	},
	{
		id: 'gsi-1m',
		label: 'gsi japan 1m',
		coverage: 'japan only · dem1a 1 m lidar where surveyed, else dem5a / dem10b',
		encoding: 'gsi',
		minZoom: 0,
		maxZoom: 17,
		tileSize: 256,
		// DEM1A is patchy, so its gaps and missing tiles fall back through 5 m to 10 m.
		fillGaps: true,
		url: (z, x, y) =>
			z >= 16
				? `https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/${z}/${x}/${y}.png`
				: z === 15
					? `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`
					: `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`,
		attribution: '国土地理院 (GSI Japan) 標高タイル'
	}
];

export function findProvider(id: string): TerrainProvider {
	return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** Decode RGB(A) pixels into elevations. */
export function decodePixels(rgba: Uint8ClampedArray, encoding: Encoding): Float32Array {
	const n = rgba.length / 4;
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const r = rgba[4 * i],
			g = rgba[4 * i + 1],
			b = rgba[4 * i + 2],
			a = rgba[4 * i + 3];
		if (a === 0) {
			out[i] = NaN;
		} else if (encoding === 'terrarium') {
			out[i] = r * 256 + g + b / 256 - 32768;
		} else {
			// GSI: 24-bit two's complement in 0.01 m, with 2^23 as nodata.
			const x = r * 65536 + g * 256 + b;
			out[i] = x === 8388608 ? NaN : x < 8388608 ? x * 0.01 : (x - 16777216) * 0.01;
		}
	}
	return out;
}

/** A decoded tile: `size` × `size` elevations in metres, row-major from the north-west. */
export interface Tile {
	size: number;
	data: Float32Array;
}

const cache = new Map<string, Promise<Tile | null>>();
const CACHE_LIMIT = 400;
/** And by size: decoded tiles are 256 KB to 1 MB each, so a count alone is a poor limit. */
const CACHE_BYTES = 96 * 1024 * 1024;
const cacheBytes = new Map<string, number>();
let cachedBytes = 0;
function forget(key: string) {
	cache.delete(key);
	cachedBytes -= cacheBytes.get(key) ?? 0;
	cacheBytes.delete(key);
}

async function fetchTile(
	p: TerrainProvider,
	z: number,
	x: number,
	y: number
): Promise<Tile | null> {
	// Not abortable: tiles are shared through the cache, so a superseded request still warms it.
	const res = await fetch(p.url(z, x, y));
	if (res.status === 404 || res.status === 204) return null;
	if (!res.ok) throw new Error(`${p.label} ${z}/${x}/${y}: http ${res.status}`);
	const bmp = await createImageBitmap(await res.blob(), {
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'none'
	});
	const canvas = new OffscreenCanvas(bmp.width, bmp.height);
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bmp, 0, 0);
	const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: 'srgb' });
	bmp.close();
	return { size: canvas.width, data: decodePixels(data, p.encoding) };
}

/** How many zoom levels to climb looking for an ancestor when a tile is missing. */
const MAX_FALLBACK = 4;

/**
 * A tile, or its nearest available ancestor upsampled to cover the same area. With `fillGaps`
 * the ancestor also patches nodata inside a tile that does exist.
 */
function getTile(
	p: TerrainProvider,
	z: number,
	x: number,
	y: number,
	depth = 0
): Promise<Tile | null> {
	const key = `${p.id}/${z}/${x}/${y}`;
	let hit = cache.get(key);
	if (!hit) {
		hit = fetchTile(p, z, x, y).then(async (t) => {
			const gaps = t !== null && p.fillGaps === true && t.data.some(Number.isNaN);
			if ((t && !gaps) || z <= p.minZoom || depth >= MAX_FALLBACK) return t;
			const parent = await getTile(p, z - 1, x >> 1, y >> 1, depth + 1);
			if (!parent) return t;
			const fill = upsampleQuadrant(parent, x & 1, y & 1);
			// Parent and child tiles are the same size for every provider.
			if (!t || t.size !== fill.size) return t ?? fill;
			for (let i = 0; i < t.data.length; i++) if (Number.isNaN(t.data[i])) t.data[i] = fill.data[i];
			return t;
		});
		// Don't cache failures (network errors) so they can be retried.
		hit.catch(() => forget(key));
		cache.set(key, hit);
		hit
			.then((t) => {
				if (!t || !cache.has(key)) return;
				cacheBytes.set(key, t.data.byteLength);
				cachedBytes += t.data.byteLength;
				// Oldest first. Tiles something still holds stay alive; this only lets go of ours.
				for (const old of cache.keys()) {
					if (cache.size <= CACHE_LIMIT && cachedBytes <= CACHE_BYTES) break;
					if (old !== key) forget(old);
				}
			})
			.catch(() => {});
	}
	return hit;
}

/**
 * A decoded tile from a provider, through a shared cache. Missing tiles come back as their
 * nearest ancestor upsampled (see `getTile`), so callers only see `null` where there is no data
 * at all. Shared by the contour, diorama and snowboard tools.
 */
export function loadTile(p: TerrainProvider, z: number, x: number, y: number) {
	return getTile(p, z, x, y);
}

function upsampleQuadrant(parent: Tile, qx: number, qy: number): Tile {
	const n = parent.size;
	const half = n / 2;
	const out = new Float32Array(n * n);
	for (let j = 0; j < n; j++) {
		const fy = Math.min(n - 1, Math.max(0, qy * half + (j + 0.5) / 2 - 0.5));
		for (let i = 0; i < n; i++) {
			const fx = Math.min(n - 1, Math.max(0, qx * half + (i + 0.5) / 2 - 0.5));
			out[j * n + i] = bilinear(parent.data, n, n, fx, fy);
		}
	}
	return { size: n, data: out };
}

/**
 * Bilinear sample of a row-major grid at fractional pixel coordinates, where pixel (i, j) is
 * centred on (i, j). Coordinates are clamped to the grid.
 */
export function bilinear(d: Float32Array, w: number, h: number, fx: number, fy: number): number {
	const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
	const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
	const x1 = Math.min(w - 1, x0 + 1);
	const y1 = Math.min(h - 1, y0 + 1);
	const tx = fx - x0;
	const ty = fy - y0;
	const a = d[y0 * w + x0],
		b = d[y0 * w + x1],
		c = d[y1 * w + x0],
		e = d[y1 * w + x1];
	return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}

const MAX_TILES = 64;

/** Pick the zoom whose pixels are about as fine as the grid spacing, within a tile budget. */
export function chooseZoom(
	p: TerrainProvider,
	box: MercatorBox,
	gridWidth: number,
	maxTiles = MAX_TILES
) {
	const spacing = (box.x1 - box.x0) / Math.max(1, gridWidth - 1);
	let z = Math.ceil(Math.log2(1 / (spacing * p.tileSize)));
	z = Math.max(p.minZoom, Math.min(p.maxZoom, z));
	while (z > p.minZoom && tileCount(box, z) > maxTiles) z--;
	return z;
}

/** The XYZ tile indices covering a mercator box at a zoom, inclusive. */
export function tileRange(box: MercatorBox, z: number) {
	const n = 2 ** z;
	const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
	return { tx0: clamp(box.x0), ty0: clamp(box.y0), tx1: clamp(box.x1), ty1: clamp(box.y1) };
}

function tileCount(box: MercatorBox, z: number) {
	const r = tileRange(box, z);
	return (r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1);
}

export interface ApiGridResult {
	grid: Grid;
	zoom: number;
	tiles: number;
	/** Approximate source resolution in metres per pixel. */
	resolution: number;
}

/** Sample a gridWidth × gridHeight elevation grid over a mercator box from a tile provider. */
export async function sampleApiGrid(
	p: TerrainProvider,
	box: MercatorBox,
	gridWidth: number,
	gridHeight: number,
	signal?: AbortSignal
): Promise<ApiGridResult> {
	const z = chooseZoom(p, box, gridWidth);
	const { tx0, ty0, tx1, ty1 } = tileRange(box, z);
	const jobs: Promise<Tile | null>[] = [];
	for (let ty = ty0; ty <= ty1; ty++)
		for (let tx = tx0; tx <= tx1; tx++) jobs.push(getTile(p, z, tx, ty));
	const tiles = await Promise.all(jobs);
	signal?.throwIfAborted();

	const size = tiles.find((t) => t)?.size ?? p.tileSize;
	const nx = tx1 - tx0 + 1;
	const ny = ty1 - ty0 + 1;
	const mw = nx * size;
	const mh = ny * size;
	const mosaic = new Float32Array(mw * mh).fill(NaN);
	tiles.forEach((t, k) => {
		if (!t) return;
		const ox = (k % nx) * size;
		const oy = Math.floor(k / nx) * size;
		for (let j = 0; j < size; j++)
			mosaic.set(t.data.subarray(j * size, (j + 1) * size), (oy + j) * mw + ox);
	});

	const scale = 2 ** z * size;
	const data = new Float32Array(gridWidth * gridHeight);
	for (let j = 0; j < gridHeight; j++) {
		const my = box.y0 + ((box.y1 - box.y0) * j) / (gridHeight - 1);
		const fy = my * scale - ty0 * size - 0.5;
		for (let i = 0; i < gridWidth; i++) {
			const mx = box.x0 + ((box.x1 - box.x0) * i) / (gridWidth - 1);
			const fx = mx * scale - tx0 * size - 0.5;
			data[j * gridWidth + i] = bilinear(mosaic, mw, mh, fx, fy);
		}
	}
	const lat = yToLat((box.y0 + box.y1) / 2);
	return {
		grid: { width: gridWidth, height: gridHeight, data },
		zoom: z,
		tiles: tiles.length,
		resolution: metresPerUnit(lat) / scale
	};
}
