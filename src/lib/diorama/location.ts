import type { FeatureCollection } from 'geojson';

/**
 * Where the data for a ski location lives, by its id (such as `appi-kogen`). A page can read
 * from somewhere else, such as its own static files, by giving `fetchLocation` another `base`.
 */
export const LOCATION_BASE_URL = 'https://content.snowline.jp/terrain/';

export const DEFAULT_LOCATION_ID = 'appi-kogen';

/** Ids are path segments: lowercase letters, digits, `-`, `_` and `.`, nothing that leaves the directory. */
export const isLocationId = (id: string) => /^[a-z0-9][a-z0-9._-]*$/i.test(id);

/** The files a location is made of. */
export function locationUrls(locationId: string, baseUrl = LOCATION_BASE_URL) {
	const base = baseUrl + encodeURIComponent(locationId);
	return {
		/** Runs, lifts, base and peak, written by the ski features export. */
		features: `${base}-ski-features.geojson`,
		/**
		 * Woods, water, buildings, roads and car parks from OpenStreetMap, written by
		 * `pnpm diorama-scene build`; each feature has a `kind`.
		 */
		scene: `${base}-scene.geojson`,
		/** What the scene file replaced: only its woods. Read when a location has no scene file yet. */
		woods: `${base}-woods.geojson`,
		/** The terrain as a diorama GLB, exported from the Mountain Diorama tool. */
		glb: `${base}.glb`
	};
}

export type LocationFeatures = FeatureCollection & {
	metadata?: { locationId?: string; name?: string; nameJa?: string };
};

export interface LocationData {
	locationId: string;
	features: LocationFeatures;
	/**
	 * The scene features (`kind` of `wood`, `water`, `waterway`, `building`, `road` or
	 * `carpark`). Only woods when the location has the older woods file, empty when it has neither.
	 */
	scene: FeatureCollection;
	/** The terrain GLB, or null when the location has none and the terrain has to be built. */
	glb: ArrayBuffer | null;
	/** Files that were not there, by name, so the page can say so. */
	missing: ('scene' | 'glb')[];
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** A fetch that treats 404 as "not there" (null) and anything else that is not ok as an error. */
async function optional<T>(
	fetch: typeof globalThis.fetch,
	url: string,
	read: (r: Response) => Promise<T>,
	signal?: AbortSignal
): Promise<T | null> {
	const response = await fetch(url, { signal });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
	return read(response);
}

/**
 * Fetch everything for a location. The features are required; the scene and the GLB are
 * optional, so a location can be shown before all of its files are uploaded.
 */
export async function fetchLocation(
	locationId: string,
	{
		fetch = globalThis.fetch,
		signal,
		base = LOCATION_BASE_URL
	}: { fetch?: typeof globalThis.fetch; signal?: AbortSignal; base?: string } = {}
): Promise<LocationData> {
	if (!isLocationId(locationId))
		throw new Error(`Not a location id: ${JSON.stringify(locationId)}`);
	const urls = locationUrls(locationId, base);
	const collection = (r: Response) => r.json() as Promise<FeatureCollection>;
	const [features, scene, glb] = await Promise.all([
		optional(fetch, urls.features, (r) => r.json() as Promise<LocationFeatures>, signal),
		// A location exported before the scene tool may still have only its woods.
		optional(fetch, urls.scene, collection, signal).then(
			(s) => s ?? optional(fetch, urls.woods, collection, signal)
		),
		optional(fetch, urls.glb, (r) => r.arrayBuffer(), signal)
	]);
	if (!features) throw new Error(`No data for location "${locationId}"`);
	if (features.type !== 'FeatureCollection' || !Array.isArray(features.features)) {
		throw new Error(`Not a GeoJSON FeatureCollection: ${urls.features}`);
	}
	const missing: LocationData['missing'] = [];
	if (!scene) missing.push('scene');
	if (!glb) missing.push('glb');
	return { locationId, features, scene: scene ?? EMPTY, glb, missing };
}
