/**
 * The terrain the tool reads: a coarse grid of the whole region Fuji can be seen from, a finer
 * one of the mountain itself, and spot heights for wherever the observer stands.
 */
import { bilinear, loadTile, sampleApiGrid, type TerrainProvider } from '$lib/contour/terrain-api';
import {
	latToY,
	lonToX,
	metresPerUnit,
	xToLon,
	yToLat,
	type MercatorBox
} from '$lib/contour/mercator';
import { gridSampler } from '$lib/diorama/sampler';
import { FUJI, type Elevation, type TerrainGrid } from './alignment';

/** Everything within about 200 km of the summit, where the mountain is a sight at all. */
export const REGION: MercatorBox = {
	x0: lonToX(FUJI.lon - 2.3),
	x1: lonToX(FUJI.lon + 2.3),
	y0: latToY(FUJI.lat + 1.7),
	y1: latToY(FUJI.lat - 1.7)
};

/** The mountain: its cone is about 40 km across at the base. */
export const MOUNTAIN: MercatorBox = {
	x0: lonToX(FUJI.lon - 0.28),
	x1: lonToX(FUJI.lon + 0.28),
	y0: latToY(FUJI.lat + 0.23),
	y1: latToY(FUJI.lat - 0.23)
};

export interface Terrain {
	/** Coarse, about 800 m between samples. */
	region: TerrainGrid;
	/** Fine, about 100 m between samples. */
	mountain: TerrainGrid;
	/** Elevation anywhere in the region: the mountain grid where it applies, else the coarse one. */
	ground: Elevation;
	resolution: { region: number; mountain: number };
}

function asGrid(box: MercatorBox, width: number, height: number, data: Float32Array): TerrainGrid {
	return {
		west: xToLon(box.x0),
		east: xToLon(box.x1),
		north: yToLat(box.y0),
		south: yToLat(box.y1),
		width,
		height,
		data
	};
}

/**
 * Both grids come from a mercator sampling, so their rows are equally spaced in mercator y, not
 * latitude. Over a few degrees the difference is a fraction of a sample; the skyline and the
 * line of sight read them as if the rows were in latitude, which is close enough for a horizon.
 */
export async function loadTerrain(
	provider: TerrainProvider,
	signal?: AbortSignal
): Promise<Terrain> {
	const [region, mountain] = await Promise.all([
		sampleApiGrid(provider, REGION, 512, 512, signal),
		sampleApiGrid(provider, MOUNTAIN, 512, 512, signal)
	]);
	const sampleRegion = gridSampler(region.grid, REGION);
	const sampleMountain = gridSampler(mountain.grid, MOUNTAIN);
	const ground: Elevation = (lon, lat) => {
		const fine = sampleMountain(lon, lat);
		return Number.isNaN(fine) ? sampleRegion(lon, lat) : fine;
	};
	return {
		region: asGrid(REGION, 512, 512, region.grid.data),
		mountain: asGrid(MOUNTAIN, 512, 512, mountain.grid.data),
		ground,
		resolution: { region: region.resolution, mountain: mountain.resolution }
	};
}

/** A finer grid of the ground around the observer, so the foreground of the view holds up. */
export interface Patch {
	grid: TerrainGrid;
	sample: Elevation;
	resolution: number;
}

export async function loadPatch(
	provider: TerrainProvider,
	lon: number,
	lat: number,
	widthMetres = 24_000,
	n = 384,
	signal?: AbortSignal
): Promise<Patch> {
	const half = widthMetres / 2 / metresPerUnit(lat);
	const box: MercatorBox = {
		x0: lonToX(lon) - half,
		x1: lonToX(lon) + half,
		y0: latToY(lat) - half,
		y1: latToY(lat) + half
	};
	const { grid, resolution } = await sampleApiGrid(provider, box, n, n, signal);
	return { grid: asGrid(box, n, n, grid.data), sample: gridSampler(grid, box), resolution };
}

/** The ground elevation at one spot from a single detailed tile, in metres; NaN with no data. */
export async function elevationAt(
	provider: TerrainProvider,
	lon: number,
	lat: number,
	zoom = 13
): Promise<number> {
	const z = Math.min(zoom, provider.maxZoom);
	const n = 2 ** z;
	const fx = lonToX(lon) * n;
	const fy = latToY(lat) * n;
	const tx = Math.floor(fx);
	const ty = Math.floor(fy);
	const tile = await loadTile(provider, z, tx, ty);
	if (!tile) return NaN;
	const s = tile.size;
	return bilinear(tile.data, s, s, (fx - tx) * s - 0.5, (fy - ty) * s - 0.5);
}
