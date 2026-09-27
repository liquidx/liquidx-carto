import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// The map fetches its GeoJSON in the browser.
export const ssr = false;

export const load: PageLoad = () => {
	const tool = findTool('japan-train-lines-flat');
	if (!tool) error(404, 'not found');
	return { tool, fullBleed: true };
};
