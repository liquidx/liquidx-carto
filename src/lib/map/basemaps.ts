/**
 * Basemaps for carto's maps. `terrain` is the OpenFreeMap dark vector style with hillshade;
 * the others are keyless raster tile services layered over it. All send CORS headers, which
 * WebGL needs to draw them.
 */
import type * as maplibregl from 'maplibre-gl';

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

/** The vector style every carto map starts from. OpenFreeMap: free, no key. */
export const BASE_STYLE = 'https://tiles.openfreemap.org/styles/dark';

type PaintProperty = Parameters<maplibregl.Map['setPaintProperty']>[1];
/** Paint overrides for the OpenFreeMap dark style. */
const BASE_PAINT: [layer: string, prop: PaintProperty, value: string][] = [
	['background', 'background-color', '#27272c'],
	['water', 'fill-color', '#18222b'],
	['waterway', 'line-color', '#18222b'],
	['landcover_wood', 'fill-color', '#2f2f34'],
	['landuse_park', 'fill-color', '#2f2f34'],
	['building', 'fill-color', '#202024']
];

export interface Basemaps {
	/** Layers of the vector style itself, captured before any are added. */
	styleLayers: { id: string; type: string }[];
	/** The first label layer: overlays added before it sit under the place names. */
	firstSymbol: string | undefined;
}

/**
 * Restyle the vector basemap and add the raster basemaps and global hillshade, all hidden.
 * Call once the style has loaded, before adding any other layers.
 */
export function installBasemaps(m: maplibregl.Map): Basemaps {
	// The stock dark style is near-black; lift it so terrain shading reads clearly.
	for (const [id, prop, value] of BASE_PAINT)
		if (m.getLayer(id)) m.setPaintProperty(id, prop, value);
	// Light labels with a dark halo stay legible over the brighter hillshade.
	for (const l of m.getStyle().layers) {
		if (l.type !== 'symbol' || !l.layout?.['text-field']) continue;
		m.setPaintProperty(l.id, 'text-color', '#c9c9d0');
		m.setPaintProperty(l.id, 'text-halo-color', 'rgba(8, 8, 10, 0.85)');
		m.setPaintProperty(l.id, 'text-halo-width', 1.2);
	}
	const styleLayers = m.getStyle().layers.map((l) => ({ id: l.id, type: l.type }));
	const firstSymbol = styleLayers.find((l) => l.type === 'symbol')?.id;
	// Raster basemaps sit over the vector fills but under its labels; only one is shown.
	for (const b of RASTER_BASEMAPS) {
		m.addSource(`base-${b.id}`, {
			type: 'raster',
			tiles: b.tiles,
			tileSize: b.tileSize,
			maxzoom: b.maxzoom,
			attribution: b.attribution
		});
		m.addLayer(
			{
				id: `base-${b.id}`,
				type: 'raster',
				source: `base-${b.id}`,
				layout: { visibility: 'none' }
			},
			firstSymbol
		);
	}
	// Global hillshade from terrain tiles, under the basemap labels.
	m.addSource('dem', {
		type: 'raster-dem',
		tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
		encoding: 'terrarium',
		tileSize: 256,
		maxzoom: 15,
		attribution: 'Terrain Tiles · Mapzen'
	});
	m.addLayer(
		{
			id: 'hillshade',
			type: 'hillshade',
			source: 'dem',
			layout: { visibility: 'none' },
			paint: {
				'hillshade-exaggeration': 0.8,
				'hillshade-shadow-color': '#050506',
				'hillshade-highlight-color': '#f2f2f5',
				'hillshade-accent-color': '#000000'
			}
		},
		firstSymbol
	);
	return { styleLayers, firstSymbol };
}

/** Show one basemap. A raster basemap hides the vector style, except labels it lacks. */
export function showBasemap(
	m: maplibregl.Map,
	{ styleLayers }: Basemaps,
	basemap: BasemapId,
	hillshade: boolean
) {
	const vis = (on: boolean) => (on ? 'visible' : 'none');
	const raster = RASTER_BASEMAPS.find((b) => b.id === basemap);
	for (const b of RASTER_BASEMAPS)
		m.setLayoutProperty(`base-${b.id}`, 'visibility', vis(b === raster));
	for (const l of styleLayers)
		m.setLayoutProperty(l.id, 'visibility', vis(!raster || (raster.labels && l.type === 'symbol')));
	m.setLayoutProperty('hillshade', 'visibility', vis(hillshade && !raster));
}
