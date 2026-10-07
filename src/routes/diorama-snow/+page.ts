import { error } from '@sveltejs/kit';
import type { FeatureCollection } from 'geojson';
import { asset } from '$app/paths';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	const tool = findTool('diorama-snow');
	if (!tool) error(404, 'not found');
	const response = await fetch(asset('/diorama/appi-kogen-ski-features.geojson'));
	return {
		tool,
		features: (await response.json()) as FeatureCollection & { metadata?: { name?: string } }
	};
};
