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
/** Ground covered by one tile of the grain texture. */
const GRAIN_METRES = 6;
/** The snow texture's long side is capped at this many pixels. */
const MAX_TEXTURE_PX = 2048;
/** The mask need only tell a run from the woods: coarser than the colour. */
const MASK_METRES_PER_PIXEL = 4;

export interface Ground {
	texture: THREE.CanvasTexture;
	/**
	 * Fine snow grain, a small tile repeated every `GRAIN_METRES` across the frame, for the
	 * terrain's bump map: the colour texture is far too coarse to show the surface streaming
	 * past, and this is what gives a sense of speed.
	 */
	grain: THREE.CanvasTexture;
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
	// A resort several kilometres across would make a texture of tens of millions of pixels,
	// which is what runs phones out of memory: cap the long side, and the mask (only read by
	// the physics and the tree scatter, at a 10 m clearance) coarser still.
	const long = Math.max(frame.width, frame.height);
	const colourMpp = Math.max(metresPerPixel, long / MAX_TEXTURE_PX);
	const maskMpp = Math.max(colourMpp, MASK_METRES_PER_PIXEL);
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
		return { w, h, toPx, stroke };
	};

	// Colour.
	const { w, h, stroke } = scaled(colourMpp);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d')!;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.fillStyle = '#e4e9f1';
	ctx.fillRect(0, 0, w, h);
	// Wind-worked off-piste snow: faint speckle so the untouched slopes read as a surface,
	// as a small tile repeated rather than noise the size of the whole canvas.
	const speckleTile = document.createElement('canvas');
	speckleTile.width = speckleTile.height = 128;
	const st = speckleTile.getContext('2d')!;
	const speckle = st.createImageData(128, 128);
	for (let i = 0; i < speckle.data.length; i += 4) {
		const v = Math.random();
		speckle.data[i] = speckle.data[i + 1] = speckle.data[i + 2] = v > 0.5 ? 255 : 190;
		speckle.data[i + 3] = 14;
	}
	st.putImageData(speckle, 0, 0);
	ctx.fillStyle = ctx.createPattern(speckleTile, 'repeat')!;
	ctx.fillRect(0, 0, w, h);
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
	const { w: mw, h: mh, toPx: maskPx, stroke: maskStroke } = scaled(maskMpp);
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

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	texture.generateMipmaps = true;
	texture.minFilter = THREE.LinearMipmapLinearFilter;

	// Grain: wind-worked snow as soft blobs a few centimetres across, blurred so the tile
	// repeats without a visible seam, over fine noise.
	const grainCanvas = document.createElement('canvas');
	const G = 256;
	grainCanvas.width = grainCanvas.height = G;
	const g = grainCanvas.getContext('2d')!;
	g.fillStyle = '#808080';
	g.fillRect(0, 0, G, G);
	const noise = g.createImageData(G, G);
	for (let i = 0; i < noise.data.length; i += 4) {
		const v = 128 + (Math.random() - 0.5) * 80;
		noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
		noise.data[i + 3] = 255;
	}
	g.putImageData(noise, 0, 0);
	g.filter = 'blur(2px)';
	for (let i = 0; i < 260; i++) {
		const r = 4 + Math.random() * 14;
		const x = Math.random() * G;
		const y = Math.random() * G;
		g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.24)';
		// Drawn at the tile's wrapped positions too, so the edges match up.
		for (const ox of [-G, 0, G])
			for (const oy of [-G, 0, G]) {
				g.beginPath();
				g.ellipse(x + ox, y + oy, r * 1.8, r, 0.4, 0, Math.PI * 2);
				g.fill();
			}
	}
	g.filter = 'none';
	const grain = new THREE.CanvasTexture(grainCanvas);
	grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
	grain.repeat.set(frame.width / GRAIN_METRES, frame.height / GRAIN_METRES);
	grain.anisotropy = 8;
	grain.generateMipmaps = true;
	grain.minFilter = THREE.LinearMipmapLinearFilter;

	return {
		texture,
		grain,
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
		dispose: () => {
			texture.dispose();
			grain.dispose();
		}
	};
}
