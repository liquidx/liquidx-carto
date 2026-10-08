import { error } from '@sveltejs/kit';
import type { FeatureCollection } from 'geojson';
import { asset } from '$app/paths';
import type { FeaturesFile } from '$lib/snowboard/resort';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// three.js needs the browser.
export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	const tool = findTool('snowboard-sim');
	if (!tool) error(404, 'not found');
	const [features, woods] = await Promise.all([
		fetch(asset('/diorama/appi-kogen-ski-features.geojson')).then((r) => r.json()),
		// Wooded areas from OpenStreetMap, written by `pnpm diorama-woods build`; optional.
		fetch(asset('/diorama/appi-kogen-woods.geojson')).then((r) => (r.ok ? r.json() : null))
	]);
	return {
		tool,
		// Fills the viewport below the header; the crumb names the page.
		fullBleed: true,
		features: features as FeaturesFile,
		woods: woods as FeatureCollection | null
	};
};
