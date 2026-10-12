import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

// The controls start from what this browser last saved, which a server render can't know.
export const ssr = false;

export const load: PageLoad = () => {
	const tool = findTool('tokyo-outline');
	if (!tool) error(404, 'not found');
	return { tool };
};
