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
	overture: {
		name: 'overture maps',
		by: '© openstreetmap contributors, odbl · via overture maps',
		use: 'woods, water, buildings, roads and car parks',
		url: 'https://overturemaps.org'
	},
	ksjBoundaries: {
		name: '国土数値情報 行政区域データ',
		by: '国土交通省 (mlit japan) · n03, 2025',
		use: 'prefecture coastline and municipal borders',
		url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html'
	},
	reearthBuildings: {
		name: 're:earth buildings',
		by: 'buildings © openstreetmap contributors, overture maps foundation (odbl) · re:earth',
		use: 'buildings in the preview and in the way of sightlines',
		url: 'https://buildings.reearth.land'
	},
	overpass: {
		name: 'overpass api',
		by: '© openstreetmap contributors, odbl',
		use: 'parks, streets, bridges and viewpoints along the line',
		url: 'https://overpass-api.de'
	},
	nominatim: {
		name: 'nominatim',
		by: '© openstreetmap contributors, odbl',
		use: 'place search',
		url: 'https://nominatim.org'
	},
	ksjRail: {
		name: '国土数値情報 鉄道データ',
		by: '国土交通省 (mlit japan) · n02, 2019',
		use: 'railway lines and stations',
		url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2019.html'
	},
	prefectures: {
		name: 'open-data-jp-prefectures-geojson',
		by: 'piuccio, mit · from 国土数値情報 行政区域データ, 国土交通省 (mlit japan)',
		use: 'prefecture shapes',
		url: 'https://github.com/piuccio/open-data-jp-prefectures-geojson'
	},
	japanOutline: {
		name: 'simplified japan',
		by: '@liquidx on observable · from simplified earth',
		use: 'japan outline',
		url: 'https://observablehq.com/@liquidx/simplified-japan'
	},
	hokkaidoEv: {
		name: '北海道のEV・PHV充電器マップ',
		by: '一般社団法人北海道開発技術センター · data as of 2026-06-01, accuracy not guaranteed',
		use: 'charging sites',
		url: 'https://decnet.or.jp/hokkaido_evphv'
	},
	dataofjapanLand: {
		name: 'dataofjapan/land',
		by: 'dataofjapan on github',
		use: 'hokkaido coastline',
		url: 'https://github.com/dataofjapan/land'
	},
	snowline: {
		name: 'snowline',
		by: 'snowline.jp',
		use: 'resorts, their runs and lifts, scene and terrain models',
		url: 'https://snowline.jp'
	},
	tessera: {
		name: 'tessera',
		by: 'university of cambridge eeg and dclimate · cc by-sa',
		use: 'embeddings the classifier is trained on',
		url: 'https://geotessera.org'
	},
	openSkiData: {
		name: 'openskidata',
		by: 'openskidata.org · © openstreetmap contributors, odbl',
		use: 'ski runs, lifts and resort area',
		url: 'https://openskidata.org/'
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

/** Behind both Japan Train Lines pages. */
export const TRAIN_LINES_CREDITS: Credit[] = [
	CREDITS.ksjRail,
	CREDITS.prefectures,
	CREDITS.japanOutline
];
