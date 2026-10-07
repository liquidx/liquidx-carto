/**
 * The game's coordinate frame: metres from the centre of the play area, x east, y up and
 * z south (right-handed with y up, as in three.js and the diorama). Positions are scaled
 * mercator, which is conformal, so over a few kilometres the distortion is negligible.
 */
import type { Position } from 'geojson';
import { latToY, lonToX, metresPerUnit, type MercatorBox } from '$lib/contour/mercator';

export interface LocalFrame {
	/** The mercator box the frame covers. */
	box: MercatorBox;
	/** Mercator centre. */
	cx: number;
	cy: number;
	/** Metres per normalised mercator unit at the centre latitude. */
	scale: number;
	/** Ground size in metres. */
	width: number;
	height: number;
	/** World x and z of a GeoJSON position. */
	toWorld(p: Position | readonly number[]): [x: number, z: number];
	/** World x and z of a normalised mercator point. */
	mercatorToWorld(mx: number, my: number): [x: number, z: number];
	/** Normalised mercator of a world x and z. */
	worldToMercator(x: number, z: number): [mx: number, my: number];
}

export function createFrame(box: MercatorBox, centreLat: number): LocalFrame {
	const cx = (box.x0 + box.x1) / 2;
	const cy = (box.y0 + box.y1) / 2;
	const scale = metresPerUnit(centreLat);
	return {
		box,
		cx,
		cy,
		scale,
		width: (box.x1 - box.x0) * scale,
		height: (box.y1 - box.y0) * scale,
		toWorld: (p) => [(lonToX(p[0]) - cx) * scale, (latToY(p[1]) - cy) * scale],
		mercatorToWorld: (mx, my) => [(mx - cx) * scale, (my - cy) * scale],
		worldToMercator: (x, z) => [x / scale + cx, z / scale + cy]
	};
}
