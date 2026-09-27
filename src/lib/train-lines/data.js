import { asset } from '$app/paths';

// Data files served from static/japan-train-lines/.
export const DATA_URLS = {
	railroad: asset('/japan-train-lines/N02-19_RailroadSection.geojson'),
	stations: asset('/japan-train-lines/N02-19_Station.geojson'),
	japanOutline: asset('/japan-train-lines/japan-outline.geojson'),
	lineRegionIndex: asset('/japan-train-lines/line-region-index.json'),
	prefecturePolygons: asset('/japan-train-lines/prefecture-polygons.json')
};
