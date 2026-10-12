import { error } from '@sveltejs/kit';
import { findTool } from '$lib/tools';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	const tool = findTool('tokyo-outline');
	if (!tool) error(404, 'not found');
	return { tool };
};
