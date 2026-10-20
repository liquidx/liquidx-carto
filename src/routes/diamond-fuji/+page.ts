import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// Everything happens in the browser: MapLibre and terrain tiles.
export const ssr = false;

export const load: PageLoad = () => {
	const tool = findTool('diamond-fuji');
	if (!tool) error(404, 'not found');
	return { tool };
};
