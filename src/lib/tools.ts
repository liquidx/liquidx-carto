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
		slug: 'tokyo-outline',
		title: 'Tokyo Outline',
		date: '2026-10-12',
		summary:
			'the outline of tokyo and every ku and shi inside it, coloured, jittered and exported as a png.'
	},
	{
		slug: 'snowboard-sim',
		title: 'Snowboard Sim',
		date: '2026-10-08',
		summary: 'a simulation of riding down the real terrain of a mountain.'
	},
	{
		slug: 'diorama-snow',
		title: 'Snow Diorama',
		date: '2026-10-07',
		summary: 'a ski resort on a snow diorama.'
	},
	{
		slug: 'diorama',
		title: 'Mountain Diorama',
		date: '2026-09-25',
		summary: 'extrude terrain into a circular 3d diorama for screen or print.'
	},
	{
		slug: 'contour-maps',
		title: 'Contour Maps',
		date: '2026-09-21',
		summary: 'trace contour lines from elevation data at any interval.'
	},
	{
		slug: 'ev-jp',
		title: 'EV Charging Japan',
		date: '2026-08-30',
		summary: 'fast-charger coverage and blackspots for touring japan by ev, starting with hokkaido.'
	},
	{
		slug: 'japan-train-lines-3d',
		title: 'Japan Train Lines 3D',
		date: '2026-07-05',
		summary: 'tokyo rail network in 3d with approximate tunnel depths and a simulated timetable.'
	},
	{
		slug: 'japan-train-lines-flat',
		title: 'Japan Train Lines',
		date: '2026-05-21',
		summary:
			'every railway line in japan, by region and operator, as a map or a straightened schematic.'
	}
];

export function findTool(slug: string): Tool | undefined {
	return tools.find((t) => t.slug === slug);
}
