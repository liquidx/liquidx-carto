import type { Feature, GeoJSON, Geometry, Position } from 'geojson';

/** GeoJSON in any form: a collection, a feature, a bare geometry, or an array of those. */
export type GeoJSONInput = GeoJSON | GeoJSONInput[];

/**
 * One drawable piece of a feature. Multi-geometries are split, so a feature can yield several.
 * `coords` holds one position for a point, one path for a line, and the outer ring followed by
 * any holes for a polygon.
 */
export interface Shape {
	kind: 'point' | 'line' | 'polygon';
	coords: Position[][];
	feature: Feature;
}

function addGeometry(geometry: Geometry | null, feature: Feature, out: Shape[]) {
	if (!geometry) return;
	switch (geometry.type) {
		case 'Point':
			out.push({ kind: 'point', coords: [[geometry.coordinates]], feature });
			break;
		case 'MultiPoint':
			for (const p of geometry.coordinates) out.push({ kind: 'point', coords: [[p]], feature });
			break;
		case 'LineString':
			out.push({ kind: 'line', coords: [geometry.coordinates], feature });
			break;
		case 'MultiLineString':
			for (const l of geometry.coordinates) out.push({ kind: 'line', coords: [l], feature });
			break;
		case 'Polygon':
			out.push({ kind: 'polygon', coords: geometry.coordinates, feature });
			break;
		case 'MultiPolygon':
			for (const p of geometry.coordinates) out.push({ kind: 'polygon', coords: p, feature });
			break;
		case 'GeometryCollection':
			for (const g of geometry.geometries) addGeometry(g, feature, out);
			break;
	}
}

/** Flatten any GeoJSON into points, lines and polygons, each with the feature it came from. */
export function shapesOf(input: GeoJSONInput | null | undefined, out: Shape[] = []): Shape[] {
	if (!input) return out;
	if (Array.isArray(input)) for (const item of input) shapesOf(item, out);
	else if (input.type === 'FeatureCollection') for (const f of input.features) shapesOf(f, out);
	else if (input.type === 'Feature') addGeometry(input.geometry, input, out);
	else addGeometry(input, { type: 'Feature', properties: {}, geometry: input }, out);
	return out;
}
