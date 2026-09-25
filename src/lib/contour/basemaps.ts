/**
 * Basemaps for the area selector. `terrain` is the OpenFreeMap dark vector style with hillshade;
 * the others are keyless raster tile services layered over it. All send CORS headers, which
 * WebGL needs to draw them.
 */

export type BasemapId = 'terrain' | 'streets' | 'topo' | 'satellite' | 'gsi';

export interface RasterBasemap {
	id: Exclude<BasemapId, 'terrain'>;
	label: string;
	tiles: string[];
	tileSize: number;
	maxzoom: number;
	attribution: string;
	/** Keep the vector style's place labels on top (useful over imagery, which has none). */
	labels: boolean;
}

export const BASEMAP_OPTIONS: { value: BasemapId; label: string }[] = [
	{ value: 'terrain', label: 'terrain' },
	{ value: 'streets', label: 'streets' },
	{ value: 'topo', label: 'topo' },
	{ value: 'satellite', label: 'satellite' },
	{ value: 'gsi', label: 'gsi' }
];

export const RASTER_BASEMAPS: RasterBasemap[] = [
	{
		id: 'streets',
		label: 'streets',
		tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
		tileSize: 256,
		maxzoom: 19,
		attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
		labels: false
	},
	{
		id: 'topo',
		label: 'topo',
		tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
		tileSize: 256,
		maxzoom: 17,
		attribution:
			'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
		labels: false
	},
	{
		id: 'satellite',
		label: 'satellite',
		tiles: [
			'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
		],
		tileSize: 256,
		maxzoom: 19,
		attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
		labels: true
	},
	{
		id: 'gsi',
		label: 'gsi',
		tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
		tileSize: 256,
		maxzoom: 18,
		attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
		labels: false
	}
];
