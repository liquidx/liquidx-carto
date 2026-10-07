/** Third-party data a tool draws on, for its acknowledgements. */
export interface Credit {
	name: string;
	/** Who publishes it, and its licence where one applies. */
	by: string;
	/** What the tool uses it for. */
	use: string;
	url: string;
}

export const CREDITS = {
	awsTerrain: {
		name: 'terrain tiles',
		by: 'mapzen / tilezen on aws open data · srtm, gmted2010, etopo1, ned and others',
		use: 'elevation, hillshade',
		url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'
	},
	mapterhorn: {
		name: 'mapterhorn',
		by: '© mapterhorn · copernicus glo-30 and national lidar',
		use: 'elevation',
		url: 'https://mapterhorn.com'
	},
	reearthTerrain: {
		name: 're:earth terrain',
		by: 're:earth · mapterhorn (cc by 4.0), egm2008 geoid (nga)',
		use: 'elevation',
		url: 'https://terrain.reearth.land'
	},
	gsiDem: {
		name: '標高タイル',
		by: '国土地理院 (gsi japan)',
		use: 'elevation',
		url: 'https://maps.gsi.go.jp/development/ichiran.html'
	},
	gsiFgd: {
		name: '基盤地図情報 数値標高モデル',
		by: '国土地理院 (gsi japan)',
		use: 'elevation, when you load dem files',
		url: 'https://fgd.gsi.go.jp/download/'
	},
	openFreeMap: {
		name: 'openfreemap',
		by: 'openmaptiles · © openstreetmap contributors, odbl',
		use: 'basemap',
		url: 'https://openfreemap.org'
	},
	osmTiles: {
		name: 'openstreetmap',
		by: '© openstreetmap contributors, odbl',
		use: 'streets basemap',
		url: 'https://www.openstreetmap.org/copyright'
	},
	openTopoMap: {
		name: 'opentopomap',
		by: '© openstreetmap contributors, srtm · style cc-by-sa',
		use: 'topo basemap',
		url: 'https://opentopomap.org/about'
	},
	esriImagery: {
		name: 'world imagery',
		by: 'esri, maxar, earthstar geographics',
		use: 'satellite basemap',
		url: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9'
	},
	gsiStd: {
		name: '地理院タイル 標準地図',
		by: '国土地理院 (gsi japan)',
		use: 'gsi basemap',
		url: 'https://maps.gsi.go.jp/development/ichiran.html'
	},
	nominatim: {
		name: 'nominatim',
		by: '© openstreetmap contributors, odbl',
		use: 'place search',
		url: 'https://nominatim.org'
	}
} satisfies Record<string, Credit>;

/** Everything behind the terrain tools: elevation sources, basemaps and place search. */
export const TERRAIN_TOOL_CREDITS: Credit[] = [
	CREDITS.awsTerrain,
	CREDITS.mapterhorn,
	CREDITS.reearthTerrain,
	CREDITS.gsiDem,
	CREDITS.gsiFgd,
	CREDITS.openFreeMap,
	CREDITS.osmTiles,
	CREDITS.openTopoMap,
	CREDITS.esriImagery,
	CREDITS.gsiStd,
	CREDITS.nominatim
];
