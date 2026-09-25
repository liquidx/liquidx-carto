import { DemWorkerPool } from './pool.js';
import type { DemTile, HillshadeOptions } from './types.js';

/** Reactive metadata for a loaded tile. The heavy grid lives in `DemStore.data`. */
export interface TileMeta {
	id: string;
	name: string;
	west: number;
	south: number;
	east: number;
	north: number;
	minZ: number;
	maxZ: number;
	/** Object URL of the hillshade PNG (or null while rendering). */
	previewUrl: string | null;
}

export type LngLatBounds = { west: number; south: number; east: number; north: number };

const HILLSHADE: HillshadeOptions = { downsample: 2, azimuth: 315, altitude: 45, zFactor: 1.5 };

/** Loaded DEM files: parsed off-thread, hillshaded for the map, sampled for contouring. */
export class DemStore {
	tiles = $state<TileMeta[]>([]);
	loading = $state(0);
	errors = $state<string[]>([]);
	/** Bumped whenever the set of tiles changes, so derived grids can be invalidated. */
	version = $state(0);

	minZ = $derived(this.tiles.length ? Math.min(...this.tiles.map((t) => t.minZ)) : 0);
	maxZ = $derived(this.tiles.length ? Math.max(...this.tiles.map((t) => t.maxZ)) : 1);
	bounds = $derived.by((): LngLatBounds | null => {
		if (!this.tiles.length) return null;
		let w = Infinity,
			s = Infinity,
			e = -Infinity,
			n = -Infinity;
		for (const t of this.tiles) {
			w = Math.min(w, t.west);
			s = Math.min(s, t.south);
			e = Math.max(e, t.east);
			n = Math.max(n, t.north);
		}
		return { west: w, south: s, east: e, north: n };
	});

	/** Raw, non-reactive grids keyed by tile id. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- grids must stay out of Svelte proxies
	readonly data = new Map<string, DemTile>();

	private pool: DemWorkerPool | null = null;

	private getPool() {
		if (!this.pool) this.pool = new DemWorkerPool();
		return this.pool;
	}

	/** Load files (XML or ZIP) or URLs, then render hillshade previews. */
	async load(sources: { source: File | string; name: string }[]) {
		this.loading += sources.length;
		const pool = this.getPool();
		const added: TileMeta[] = [];
		await Promise.all(
			sources.map(async ({ source, name }) => {
				try {
					const tiles = await pool.parse(source, name);
					for (const tile of tiles) {
						if (this.data.has(tile.id)) continue;
						this.data.set(tile.id, tile);
						const { id, west, south, east, north, minZ, maxZ } = tile;
						this.tiles.push({ id, name, west, south, east, north, minZ, maxZ, previewUrl: null });
						added.push(this.tiles[this.tiles.length - 1]);
					}
				} catch (e) {
					this.errors.push(`${name}: ${(e as Error).message}`);
				} finally {
					this.loading -= 1;
				}
			})
		);
		this.version++;
		await Promise.all(
			added.map(async (entry) => {
				const tile = this.data.get(entry.id);
				if (!tile) return;
				const blob = await pool.preview(tile, HILLSHADE);
				// The tile may have been cleared while rendering.
				if (!this.data.has(entry.id)) return;
				entry.previewUrl = URL.createObjectURL(blob);
			})
		);
	}

	clear() {
		for (const t of this.tiles) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl);
		this.tiles = [];
		this.data.clear();
		this.errors = [];
		this.version++;
	}

	/** A sampler over the current tiles: bilinear elevation at lon/lat, NaN outside all tiles. */
	sampler(): (lon: number, lat: number) => number {
		const tiles = [...this.data.values()];
		let last: DemTile | null = null;
		return (lon, lat) => {
			if (!last || !contains(last, lon, lat)) {
				last = tiles.find((t) => contains(t, lon, lat)) ?? null;
				if (!last) return NaN;
			}
			return sampleTile(last, lon, lat);
		};
	}
}

function contains(t: DemTile, lon: number, lat: number) {
	return lon >= t.west && lon < t.east && lat >= t.south && lat < t.north;
}

/** Bilinear sample inside a tile; falls back to the nearest valid corner around nodata. */
export function sampleTile(tile: DemTile, lon: number, lat: number): number {
	// Continuous grid coordinates, pixel centres at +0.5.
	const fx = ((lon - tile.west) / (tile.east - tile.west)) * tile.width - 0.5;
	const fy = ((tile.north - lat) / (tile.north - tile.south)) * tile.height - 0.5;
	const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(fx)));
	const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(fy)));
	const x1 = Math.min(tile.width - 1, x0 + 1);
	const y1 = Math.min(tile.height - 1, y0 + 1);
	const tx = Math.max(0, Math.min(1, fx - x0));
	const ty = Math.max(0, Math.min(1, fy - y0));
	const d = tile.data;
	const w = tile.width;
	const a = d[y0 * w + x0],
		b = d[y0 * w + x1],
		c = d[y1 * w + x0],
		e = d[y1 * w + x1];
	if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(e)) {
		const n = d[(tx < 0.5 ? x0 : x1) + (ty < 0.5 ? y0 : y1) * w];
		if (!Number.isNaN(n)) return n;
		for (const v of [a, b, c, e]) if (!Number.isNaN(v)) return v;
		return NaN;
	}
	return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
}
