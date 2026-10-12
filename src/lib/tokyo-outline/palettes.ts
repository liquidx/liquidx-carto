export type Palette = { id: string; label: string; colors: string[] };

/** Each runs light to dark. Muted pastels, except the brighter autumn. */
export const PALETTES: Palette[] = [
	{
		id: 'ember',
		label: 'ember · yellow to red',
		colors: ['#f3e2a6', '#f0cd8c', '#ebb47c', '#e39a72', '#d9806c', '#c76a62']
	},
	{
		id: 'autumn',
		label: 'autumn · amber to crimson',
		colors: ['#f9c74f', '#f8a13f', '#f3812f', '#ea5f2c', '#d9412b', '#b5282e']
	},
	{
		id: 'tide',
		label: 'tide · mint to navy',
		colors: ['#cfe3d8', '#a9d0c7', '#86b9bd', '#6d9fb3', '#5f84a3', '#566a8c']
	},
	{
		id: 'moss',
		label: 'moss · straw to pine',
		colors: ['#e3e2b5', '#c5d19c', '#a3bd8a', '#82a67c', '#668c72', '#4f7166']
	},
	{
		id: 'blossom',
		label: 'blossom · blush to plum',
		colors: ['#f3dcd6', '#edc4c6', '#e2a9b8', '#cf91ad', '#b47ea3', '#946c95']
	},
	{
		id: 'stone',
		label: 'stone · greys',
		colors: ['#e4e2dd', '#cbc8c1', '#b0aca5', '#95918b', '#7a7772', '#605e5b']
	}
];
