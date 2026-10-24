/**
 * A mask painted once over the whole area, which the physics and tree scatter read: "on a
 * groomed run" and "keep trees off" come from the same runs and lifts the snow shader draws.
 */
import type { FeatureCollection, Position } from 'geojson';
import type { LocalFrame } from './frame';
import type { Resort } from './resort';

/** Groomed width of a run in metres. */
export const RUN_WIDTH = 36;
/** How far past the groomed snow the trees stay. */
const TREE_MARGIN = 14;
/** Trees stay this far from a run's centre line, and lifts clear a narrow strip. */
const TREE_CLEARANCE = RUN_WIDTH / 2 + TREE_MARGIN;
export const LIFT_CLEARANCE = 10;
/** The mask need only tell a run from the woods... */
const MASK_METRES_PER_PIXEL = 4;
/** ...and its long side is capped at this many pixels. */
const MAX_MASK_PX = 2048;

export interface Ground {
	/** Whether world x, z is on a groomed run. */
	groomed(x: number, z: number): boolean;
	/** Whether a tree may stand at world x, z. */
	treeAllowed(x: number, z: number): boolean;
	/** Whether the woods file covers world x, z, so where trees stand there is known. */
	woodsMapped(x: number, z: number): boolean;
}

/**
 * Paint the ground. With `woods` (wood and forest polygons, as `pnpm diorama-scene` writes
 * them) trees only stand inside those polygons; beyond the area the woods file covers, and
 * without one, they stand everywhere the runs and lifts leave free.
 */
export function paintGround(
	frame: LocalFrame,
	resort: Resort,
	woods?: FeatureCollection | null
): Ground {
	// A resort several kilometres across would make a mask of tens of millions of pixels, which
	// is what runs phones out of memory: cap the long side.
	const maskMpp = Math.max(
		MASK_METRES_PER_PIXEL,
		Math.max(frame.width, frame.height) / MAX_MASK_PX
	);
	const scaled = (mpp: number) => {
		const w = Math.ceil(frame.width / mpp);
		const h = Math.ceil(frame.height / mpp);
		const sx = w / frame.width;
		const sy = h / frame.height;
		const toPx = ([x, z]: [number, number]): [number, number] => [
			(x + frame.width / 2) * sx,
			(z + frame.height / 2) * sy
		];
		const stroke = (ctx: CanvasRenderingContext2D, path: [number, number][], width: number) => {
			ctx.lineWidth = width * sx;
			ctx.beginPath();
			path.map(toPx).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
			ctx.stroke();
		};
		/** Fill the polygon of `rings`, the outline and then its holes. */
		const fill = (ctx: CanvasRenderingContext2D, rings: [number, number][][]) => {
			ctx.beginPath();
			for (const ring of rings) {
				ring.map(toPx).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
				ctx.closePath();
			}
			ctx.fill('evenodd');
		};
		return { w, h, toPx, stroke, fill };
	};

	// Mask: red where trees must stay away, green on groomed snow.
	const { w: mw, h: mh, toPx: maskPx, stroke: maskStroke, fill: maskFill } = scaled(maskMpp);
	const maskCanvas = document.createElement('canvas');
	maskCanvas.width = mw;
	maskCanvas.height = mh;
	const m = maskCanvas.getContext('2d', { willReadFrequently: true })!;
	m.lineCap = 'round';
	m.lineJoin = 'round';
	m.fillStyle = '#000';
	m.fillRect(0, 0, mw, mh);
	m.strokeStyle = '#f00';
	for (const run of resort.runs) maskStroke(m, run.path, TREE_CLEARANCE * 2);
	for (const lift of resort.lifts) maskStroke(m, lift.path, LIFT_CLEARANCE * 2);
	// A run mapped as an area: no trees inside it, nor within the margin of its edge.
	m.fillStyle = '#f00';
	for (const area of resort.runAreas) {
		maskFill(m, area.rings);
		for (const ring of area.rings) maskStroke(m, ring, TREE_MARGIN * 2);
	}
	// Yellow keeps the red: the groomed corridor is still no place for a tree.
	m.strokeStyle = '#ff0';
	for (const run of resort.runs) maskStroke(m, run.path, RUN_WIDTH);
	// Blue where there is woodland, within the box the woods file covers.
	let woodBox: [number, number, number, number] | null = null;
	if (woods?.features.length) {
		woodBox = [Infinity, Infinity, -Infinity, -Infinity];
		m.fillStyle = '#00f';
		m.globalCompositeOperation = 'lighter';
		for (const f of woods.features) {
			const g = f.geometry;
			const polygons =
				g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
			for (const rings of polygons) {
				m.beginPath();
				for (const ring of rings) {
					ring.forEach((p: Position, i) => {
						const [x, z] = frame.toWorld(p);
						const b = woodBox!;
						b[0] = Math.min(b[0], x);
						b[1] = Math.min(b[1], z);
						b[2] = Math.max(b[2], x);
						b[3] = Math.max(b[3], z);
						const [px, py] = maskPx([x, z]);
						if (i) m.lineTo(px, py);
						else m.moveTo(px, py);
					});
					m.closePath();
				}
				m.fill('evenodd');
			}
		}
		m.globalCompositeOperation = 'source-over';
	}
	const mask = m.getImageData(0, 0, mw, mh).data;
	// Let the canvas go: the pixels are all that is kept.
	maskCanvas.width = maskCanvas.height = 0;
	const index = (x: number, z: number) => {
		const [px, py] = maskPx([x, z]);
		const i = Math.floor(px);
		const j = Math.floor(py);
		if (i < 0 || j < 0 || i >= mw || j >= mh) return -1;
		return (j * mw + i) * 4;
	};

	const inWoodBox = (x: number, z: number) =>
		!!woodBox && x >= woodBox[0] && x <= woodBox[2] && z >= woodBox[1] && z <= woodBox[3];

	return {
		groomed(x, z) {
			const i = index(x, z);
			return i >= 0 && mask[i + 1] > 128;
		},
		treeAllowed(x, z) {
			const i = index(x, z);
			if (i < 0 || mask[i] >= 128) return false;
			return !inWoodBox(x, z) || mask[i + 2] >= 128;
		},
		woodsMapped: inWoodBox
	};
}
