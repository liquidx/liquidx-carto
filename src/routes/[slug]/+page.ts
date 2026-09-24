import { error } from '@sveltejs/kit';
import { findTool, tools } from '$lib/tools';
import type { EntryGenerator, PageLoad } from './$types';

// Placeholder page for tools that don't have their own route yet.
// A static route (e.g. src/routes/contour-maps/) takes precedence over this one.
export const load: PageLoad = ({ params }) => {
	const tool = findTool(params.slug);
	if (!tool) error(404, 'not found');
	return { tool };
};

export const entries: EntryGenerator = () => tools.map((t) => ({ slug: t.slug }));
