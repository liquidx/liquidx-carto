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
		slug: 'image-format-conversion',
		title: 'Image Format Conversion',
		date: '2026-09-25',
		summary: 'convert map imagery and elevation tiles between formats, in the browser.'
	},
	{
		slug: '3d-mountain-diorama',
		title: '3D Mountain Diorama',
		date: '2026-09-25',
		summary: 'extrude terrain into a boxed 3d diorama for screen or print.'
	}
];

export function findTool(slug: string): Tool | undefined {
	return tools.find((t) => t.slug === slug);
}
