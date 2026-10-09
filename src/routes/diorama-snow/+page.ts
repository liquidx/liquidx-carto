import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import { DEFAULT_LOCATION_ID, isLocationId } from '$lib/diorama/location';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

/**
 * The location comes from `?locationId=`, fetched from snowline; without one the page shows
 * the default location from its own static files. The page fetches the data itself so it can
 * show a loading state and switch locations without a navigation.
 */
export const load: PageLoad = ({ url }) => {
	const tool = findTool('diorama-snow');
	if (!tool) error(404, 'not found');
	const requested = url.searchParams.get('locationId')?.trim();
	const valid = !!requested && isLocationId(requested);
	return {
		tool,
		locationId: valid ? requested : DEFAULT_LOCATION_ID,
		/** Read the files under `static/diorama` instead of snowline. */
		local: !valid
	};
};
