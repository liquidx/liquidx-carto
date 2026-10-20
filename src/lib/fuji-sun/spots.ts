/** Places people go for diamond fuji, with how high above the ground you stand there. */
export interface Spot {
	id: string;
	label: string;
	lon: number;
	lat: number;
	/** Metres above the ground: a deck, a tower, or just eye height. */
	eye: number;
}

export const SPOTS: Spot[] = [
	{
		id: 'yamanakako',
		label: 'lake yamanaka · hirano shore',
		lon: 138.8855,
		lat: 35.4175,
		eye: 1.6
	},
	{ id: 'takao', label: 'mount takao · summit', lon: 139.2437, lat: 35.6252, eye: 1.6 },
	{ id: 'skytree', label: 'tokyo skytree · tembo deck', lon: 139.8107, lat: 35.7101, eye: 350 },
	{ id: 'tokyo-tower', label: 'tokyo tower · main deck', lon: 139.7454, lat: 35.6586, eye: 150 },
	{ id: 'enoshima', label: 'enoshima · west shore', lon: 139.4765, lat: 35.2985, eye: 1.6 },
	{ id: 'miura', label: 'miura · tateishi beach', lon: 139.6098, lat: 35.2286, eye: 1.6 },
	{ id: 'tsukuba', label: 'mount tsukuba · summit', lon: 140.1069, lat: 36.225, eye: 1.6 },
	{
		id: 'tanuki',
		label: 'lake tanuki · west shore (sunrise)',
		lon: 138.5494,
		lat: 35.338,
		eye: 1.6
	}
];
