/** Visual styles for the rendered contour map. Only line weights and colours for now. */
export interface ContourStyle {
	id: string;
	label: string;
	background: string;
	ink: string;
	/** Stroke widths in output pixels. */
	minorWidth: number;
	majorWidth: number;
}

export const STYLES: ContourStyle[] = [
	{
		id: 'mono',
		label: 'mono',
		background: '#ffffff',
		ink: '#000000',
		minorWidth: 0.5,
		majorWidth: 1.5
	},
	{
		id: 'mono-dark',
		label: 'mono dark',
		background: '#000000',
		ink: '#ffffff',
		minorWidth: 0.5,
		majorWidth: 1.5
	}
];

/** The style a new map starts with. */
export const DEFAULT_STYLE = 'mono-dark';

export function findStyle(id: string): ContourStyle {
	return STYLES.find((s) => s.id === id) ?? STYLES[0];
}
