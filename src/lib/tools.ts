export type Tool = {
	slug: string;
	title: string;
	/** ISO date, YYYY-MM-DD */
	date: string;
	summary: string;
};

/** Every tool/experiment listed on the index, in display order. */
export const tools: Tool[] = [
	{
		slug: 'contour-maps',
		title: 'Contour Maps',
		date: '2026-09-25',
		summary: 'trace contour lines from elevation data at any interval.'
	},
	{
		slug: 'diorama',
		title: 'Mountain Diorama',
		date: '2026-09-25',
		summary: 'extrude terrain into a circular 3d diorama for screen or print.'
	},
	{
		slug: 'ev-jp',
		title: 'EV Charging Japan',
		date: '2026-09-26',
		summary: 'fast-charger coverage and blackspots for touring japan by ev, starting with hokkaido.'
	}
];

export function findTool(slug: string): Tool | undefined {
	return tools.find((t) => t.slug === slug);
}
