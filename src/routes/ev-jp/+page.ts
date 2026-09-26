import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// The map needs the browser; the data is bundled.
export const ssr = false;

export const load: PageLoad = () => {
	const tool = findTool('ev-jp');
	if (!tool) error(404, 'not found');
	return { tool };
};
