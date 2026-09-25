/**
 * Web Mercator helpers. Coordinates are normalised to [0, 1] with y increasing southwards,
 * matching MapLibre's `MercatorCoordinate` and XYZ tile addressing.
 */

/** Earth circumference at the equator in metres (WGS84). */
export const EARTH_CIRCUMFERENCE = 40_075_016.686;

export function lonToX(lon: number): number {
	return (lon + 180) / 360;
}

export function latToY(lat: number): number {
	const s = Math.sin((lat * Math.PI) / 180);
	return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function xToLon(x: number): number {
	return x * 360 - 180;
}

export function yToLat(y: number): number {
	return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/** Ground metres per normalised mercator unit at a given latitude. */
export function metresPerUnit(lat: number): number {
	return EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180);
}

/**
 * A map area in normalised mercator space: centre and width. The height follows from the
 * output aspect ratio, so the frame always matches the rendered map.
 */
export interface Frame {
	cx: number;
	cy: number;
	/** Width in normalised mercator units. */
	w: number;
}

export interface MercatorBox {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export function frameBox(f: Frame, aspect: number): MercatorBox {
	const h = f.w / aspect;
	return { x0: f.cx - f.w / 2, y0: f.cy - h / 2, x1: f.cx + f.w / 2, y1: f.cy + h / 2 };
}

/** Ground size of a box in metres, measured through its centre. */
export function boxSizeMetres(b: MercatorBox): { width: number; height: number } {
	const m = metresPerUnit(yToLat((b.y0 + b.y1) / 2));
	return { width: (b.x1 - b.x0) * m, height: (b.y1 - b.y0) * m };
}

/** Frame of a given ground width (metres) centred on lon/lat. */
export function frameAt(lon: number, lat: number, widthMetres: number): Frame {
	return { cx: lonToX(lon), cy: latToY(lat), w: widthMetres / metresPerUnit(lat) };
}
