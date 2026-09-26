import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// Everything happens in the browser: MapLibre, three.js, workers.
export const ssr = false;

export const load: PageLoad = () => {
	const tool = findTool('diorama');
	if (!tool) error(404, 'not found');
	return { tool, dev };
};
