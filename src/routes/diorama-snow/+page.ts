import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import { DEFAULT_LOCATION_ID, isLocationId } from '$lib/diorama/location';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

/**
 * The location comes from `?locationId=`; the page fetches its data itself so it can show a
 * loading state and switch locations without a navigation.
 */
export const load: PageLoad = ({ url }) => {
	const tool = findTool('diorama-snow');
	if (!tool) error(404, 'not found');
	const requested = url.searchParams.get('locationId')?.trim();
	return {
		tool,
		locationId: requested && isLocationId(requested) ? requested : DEFAULT_LOCATION_ID
	};
};
