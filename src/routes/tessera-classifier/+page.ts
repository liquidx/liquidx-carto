import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import { DEFAULT_LOCATION_ID, isLocationId } from '$lib/diorama/location';
import { loadLocations } from '$lib/diorama/locations';
import type { PageLoad } from './$types';

// The map needs the browser, and the labels live in its storage.
export const ssr = false;

/** The resort comes from `?locationId=`; without one the default from the app's own files. */
export const load: PageLoad = async ({ fetch, url }) => {
	const tool = findTool('tessera-classifier');
	if (!tool) error(404, 'not found');
	const requested = url.searchParams.get('locationId')?.trim();
	const valid = !!requested && isLocationId(requested);
	return {
		tool,
		locations: await loadLocations(fetch),
		locationId: valid ? requested : DEFAULT_LOCATION_ID,
		local: !valid
	};
};
