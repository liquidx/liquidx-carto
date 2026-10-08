/**
 * The snow surface painted once over the whole area: a colour texture for the terrain and a
 * mask the physics and tree scatter read, so "on a groomed run" and "keep trees off" come from
 * the same strokes the player sees.
 */
import type { FeatureCollection, Position } from 'geojson';
import * as THREE from 'three';
import type { LocalFrame } from './frame';
import { DIFFICULTY_COLOR, type Resort } from './resort';

/** Groomed width of a run in metres. */
export const RUN_WIDTH = 36;
/** Trees stay this far from a run's centre line, and lifts clear a narrow strip. */
const TREE_CLEARANCE = RUN_WIDTH / 2 + 14;
const LIFT_CLEARANCE = 10;

export interface Ground {
	texture: THREE.CanvasTexture;
	/** The painted surface, also used for the minimap. */
	canvas: HTMLCanvasElement;
	/** Whether world x, z is on a groomed run. */
	groomed(x: number, z: number): boolean;
	/** Whether a tree may stand at world x, z. */
	treeAllowed(x: number, z: number): boolean;
	dispose(): void;
}

/**
 * Paint the ground. With `woods` (wood and forest polygons, as `pnpm diorama-woods` writes
 * them) trees only stand inside those polygons; beyond the area the woods file covers, and
 * without one, they stand everywhere the runs and lifts leave free.
 */
export function paintGround(
	frame: LocalFrame,
	resort: Resort,
	woods?: FeatureCollection | null,
	metresPerPixel = 2
): Ground {
	const w = Math.ceil(frame.width / metresPerPixel);
	const h = Math.ceil(frame.height / metresPerPixel);
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

	// Colour.
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d')!;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.fillStyle = '#e4e9f1';
	ctx.fillRect(0, 0, w, h);
	// Wind-worked off-piste snow: faint speckle so the untouched slopes read as a surface.
	const speckle = ctx.createImageData(w, h);
	for (let i = 0; i < speckle.data.length; i += 4) {
		const v = Math.random();
		speckle.data[i] = speckle.data[i + 1] = speckle.data[i + 2] = v > 0.5 ? 255 : 190;
		speckle.data[i + 3] = 14;
	}
	ctx.putImageData(speckle, 0, 0);
	// Lift lines: a cleared strip, slightly shaded.
	ctx.strokeStyle = 'rgba(190, 200, 214, 0.6)';
	for (const lift of resort.lifts) stroke(ctx, lift.path, LIFT_CLEARANCE);
	// Runs: a groomed corridor, bright and cool, edged in the difficulty colour.
	for (const run of resort.runs) {
		ctx.strokeStyle = DIFFICULTY_COLOR[run.difficulty] + '99';
		stroke(ctx, run.path, RUN_WIDTH + 3);
	}
	ctx.strokeStyle = '#f6f8fc';
	for (const run of resort.runs) stroke(ctx, run.path, RUN_WIDTH);
	// Corduroy: a faint centre line down each run.
	ctx.strokeStyle = 'rgba(205, 214, 228, 0.5)';
	for (const run of resort.runs) stroke(ctx, run.path, 2);

	// Mask: red where trees must stay away, green on groomed snow.
	const maskCanvas = document.createElement('canvas');
	maskCanvas.width = w;
	maskCanvas.height = h;
	const m = maskCanvas.getContext('2d', { willReadFrequently: true })!;
	m.lineCap = 'round';
	m.lineJoin = 'round';
	m.fillStyle = '#000';
	m.fillRect(0, 0, w, h);
	m.strokeStyle = '#f00';
	for (const run of resort.runs) stroke(m, run.path, TREE_CLEARANCE * 2);
	for (const lift of resort.lifts) stroke(m, lift.path, LIFT_CLEARANCE * 2);
	// Yellow keeps the red: the groomed corridor is still no place for a tree.
	m.strokeStyle = '#ff0';
	for (const run of resort.runs) stroke(m, run.path, RUN_WIDTH);
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
						const [px, py] = toPx([x, z]);
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
	const mask = m.getImageData(0, 0, w, h).data;
	const index = (x: number, z: number) => {
		const [px, py] = toPx([x, z]);
		const i = Math.floor(px);
		const j = Math.floor(py);
		if (i < 0 || j < 0 || i >= w || j >= h) return -1;
		return (j * w + i) * 4;
	};

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	texture.generateMipmaps = true;
	texture.minFilter = THREE.LinearMipmapLinearFilter;

	return {
		texture,
		canvas,
		groomed(x, z) {
			const i = index(x, z);
			return i >= 0 && mask[i + 1] > 128;
		},
		treeAllowed(x, z) {
			const i = index(x, z);
			if (i < 0 || mask[i] >= 128) return false;
			if (!woodBox) return true;
			const inBox = x >= woodBox[0] && x <= woodBox[2] && z >= woodBox[1] && z <= woodBox[3];
			return !inBox || mask[i + 2] >= 128;
		},
		dispose: () => texture.dispose()
	};
}
