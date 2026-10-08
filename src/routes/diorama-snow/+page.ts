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
	const [features, woods] = await Promise.all(
		['appi-kogen-ski-features', 'appi-kogen-woods'].map((name) =>
			fetch(asset(`/diorama/${name}.geojson`)).then((response) => response.json())
		)
	);
	return {
		tool,
		features: features as FeatureCollection & { metadata?: { name?: string } },
		/** Wooded areas from OpenStreetMap, written by `pnpm diorama-woods build`. */
		woods: woods as FeatureCollection
	};
};
