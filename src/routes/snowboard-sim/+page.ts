import { error } from '@sveltejs/kit';
import type { FeatureCollection } from 'geojson';
import { asset } from '$app/paths';
import type { FeaturesFile } from '$lib/snowboard/resort';
import { DEFAULT_LOCATION_ID, isLocationId, locationUrls } from '$lib/diorama/location';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

/**
 * The resort comes from `?locationId=`, fetched from snowline; without one it is the default
 * location from the app's own static files.
 */
export const load: PageLoad = async ({ fetch, url }) => {
	const tool = findTool('snowboard-sim');
	if (!tool) error(404, 'not found');
	const requested = url.searchParams.get('locationId')?.trim();
	const remote = !!requested && isLocationId(requested);
	const locationId = remote ? requested : DEFAULT_LOCATION_ID;
	const urls = remote ? locationUrls(locationId) : locationUrls(locationId, asset('/diorama/'));
	const [features, scene] = await Promise.all([
		fetch(urls.features).then((r) => (r.ok ? r.json() : null)),
		// The scene from OpenStreetMap, written by `pnpm diorama-scene build`; optional.
		fetch(urls.scene).then((r) => (r.ok ? (r.json() as Promise<FeatureCollection>) : null))
	]);
	if (!features) error(404, `no data for location "${locationId}"`);
	// The sim only plants trees, so it keeps the scene's woods.
	const woods: FeatureCollection | null = scene && {
		type: 'FeatureCollection',
		features: scene.features.filter((f) => f.properties?.kind === 'wood')
	};
	return {
		tool,
		// Fills the viewport below the header; the crumb names the page.
		fullBleed: true,
		locationId,
		features: features as FeaturesFile,
		woods
	};
};
