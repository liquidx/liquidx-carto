import { error } from '@sveltejs/kit';
import { asset } from '$app/paths';
import type { FeaturesFile } from '$lib/snowboard/resort';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	const tool = findTool('snowboard');
	if (!tool) error(404, 'not found');
	const response = await fetch(asset('/diorama/appi-kogen-ski-features.geojson'));
	return {
		tool,
		// Fills the viewport below the header; the crumb names the page.
		fullBleed: true,
		features: (await response.json()) as FeaturesFile
	};
};
