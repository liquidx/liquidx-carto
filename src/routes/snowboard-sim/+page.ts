import { error } from '@sveltejs/kit';
import type { FeatureCollection } from 'geojson';
import type { FeaturesFile } from '$lib/snowboard/resort';
import { isLocationId, locationUrls, woodsOf } from '$lib/diorama/location';
import { loadLocations } from '$lib/diorama/locations';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

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
	const collection = (url: string) =>
		fetch(url)
			.then((r) => (r.ok ? (r.json() as Promise<FeatureCollection>) : null))
			.catch(() => null);
	const [features, scene, woods] = await Promise.all([
		fetch(urls.features).then((r) => (r.ok ? r.json() : null)),
		// The scene from OpenStreetMap, written by `pnpm diorama-scene build`; optional.
		collection(urls.scene),
		// Woods planted in place of the scene's, as the Snow Diorama does; optional.
		collection(urls.woods)
	]);
	if (!features) error(404, `no data for location "${locationId}"`);
	// The sim plants trees in the woods file's woods, else the scene's; its map shows them and the water.
	const only = (...kinds: string[]): FeatureCollection | null =>
		scene && {
			type: 'FeatureCollection',
			features: scene.features.filter((f) => kinds.includes(f.properties?.kind))
		};
	return {
		...page,
		locationId,
		features: features as FeaturesFile,
		woods: scene || woods ? woodsOf(scene, woods) : null,
		water: only('water', 'waterway')
	};
};
