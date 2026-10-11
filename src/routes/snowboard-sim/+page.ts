import { error } from '@sveltejs/kit';
import { asset } from '$app/paths';
import type { FeatureCollection } from 'geojson';
import type { FeaturesFile } from '$lib/snowboard/resort';
import { isLocationId, locationUrls } from '$lib/diorama/location';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

/** A resort the sim can be pointed at, as snowline names it. */
export type SimLocation = { id: string; nameEn: string; nameJa: string; tier?: number };
type IndexEntry = { locationId: string; shortNameEn: string; shortNameJa: string; tier?: number };

let locations: Promise<SimLocation[]> | undefined;
/**
 * The resorts to pick from: snowline's index of every resort, cut down to the ones there is
 * terrain data for (`pnpm snowboard-locations`). Read once, however often the resort changes.
 */
function loadLocations(fetch: typeof globalThis.fetch) {
	const json = <T>(path: string) =>
		fetch(asset(path)).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)));
	locations ??= Promise.all([
		json<IndexEntry[]>('/snowline-locations-index.json'),
		json<string[]>('/terrain-locations.json')
	])
		.then(([index, terrain]) => {
			const ids = new Set(terrain);
			return index
				.filter((l) => ids.has(l.locationId))
				.map((l) => ({
					id: l.locationId,
					nameEn: l.shortNameEn,
					nameJa: l.shortNameJa,
					tier: l.tier
				}))
				.sort((a, b) => a.nameEn.localeCompare(b.nameEn, 'en'));
		})
		.catch(() => {
			// Try again on the next load; a resort in the URL can still be ridden.
			locations = undefined;
			return [];
		});
	return locations;
}

/**
 * The resort comes from `?locationId=`, fetched from snowline; without one there is nothing to
 * ride yet, and the start screen asks for a resort.
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const tool = findTool('snowboard-sim');
	if (!tool) error(404, 'not found');
	// Fills the viewport below the header; the crumb names the page.
	const page = { tool, fullBleed: true, locations: await loadLocations(fetch) };
	const requested = url.searchParams.get('locationId')?.trim();
	if (!requested || !isLocationId(requested))
		return { ...page, locationId: '', features: null, woods: null, water: null };
	const locationId = requested;
	const urls = locationUrls(locationId);
	const [features, scene] = await Promise.all([
		fetch(urls.features).then((r) => (r.ok ? r.json() : null)),
		// The scene from OpenStreetMap, written by `pnpm diorama-scene build`; optional.
		fetch(urls.scene).then((r) => (r.ok ? (r.json() as Promise<FeatureCollection>) : null))
	]);
	if (!features) error(404, `no data for location "${locationId}"`);
	// The sim plants trees in the scene's woods; its map shows them and the water.
	const only = (...kinds: string[]): FeatureCollection | null =>
		scene && {
			type: 'FeatureCollection',
			features: scene.features.filter((f) => kinds.includes(f.properties?.kind))
		};
	return {
		...page,
		locationId,
		features: features as FeaturesFile,
		woods: only('wood'),
		water: only('water', 'waterway')
	};
};
