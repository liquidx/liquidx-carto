/**
 * The elevation grid behind the /tokyo-outline page's contours and relief, as baked by
 * `pnpm tokyo-outline dem` into static/tokyo-outline/dem.bin.
 */
import { unzlibSync, zlibSync } from 'fflate';
import { renderHillshade } from '../dem/hillshade.ts';

/**
 * Where the grid sits: point (i, j) is at longitude `west + i * dlon`, latitude
 * `north - j * dlat`. The steps are chosen so a cell is square on the ground.
 */
export interface DemMeta {
	width: number;
	height: number;
	west: number;
	north: number;
	dlon: number;
	dlat: number;
	/** Ground size of a cell in metres. */
	cell: number;
	/** The tile layer and zoom it was averaged down from. */
	source: string;
}

/** Stored elevations are whole decimetres. */
const SCALE = 10;
const NODATA = -32768;

/**
 * Elevations as 16-bit decimetres, each stored as the step from its western neighbour so the
 * bytes repeat and deflate well. NaN marks sea and anywhere outside the prefecture.
 */
export function encodeDem(data: Float32Array, width: number): Uint8Array {
	const steps = new Int16Array(data.length);
	let before = 0;
	for (let i = 0; i < data.length; i++) {
		if (i % width === 0) before = 0;
		const v = Number.isNaN(data[i]) ? NODATA : Math.round(data[i] * SCALE);
		steps[i] = v - before; // wraps, and so does undoing it
		before = v;
	}
	return zlibSync(new Uint8Array(steps.buffer), { level: 9 });
}

export function decodeDem(bytes: Uint8Array, width: number): Float32Array {
	const raw = unzlibSync(bytes);
	const steps = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
	const data = new Float32Array(steps.length);
	const value = new Int16Array(1);
	for (let i = 0; i < steps.length; i++) {
		value[0] = (i % width === 0 ? 0 : value[0]) + steps[i];
		data[i] = value[0] === NODATA ? NaN : value[0] / SCALE;
	}
	return data;
}

const SUN = { azimuth: 315, altitude: 45 };

/**
 * Hillshade as a PNG data URL to lay over any fill: black where the slope faces away from the
 * sun and white where it faces it, opaque in proportion, so level ground is left untouched.
 * Browser only. `exaggeration` steepens the slopes, which Tokyo's lowlands need to show at all.
 */
export function reliefImage(data: Float32Array, meta: DemMeta, exaggeration: number): string {
	const { width, height } = meta;
	const { rgba } = renderHillshade(
		{
			id: 'tokyo',
			name: 'tokyo',
			west: meta.west,
			east: meta.west + meta.dlon * width,
			north: meta.north,
			south: meta.north - meta.dlat * height,
			width,
			height,
			data,
			minZ: 0,
			maxZ: 0
		},
		{ downsample: 1, ...SUN, zFactor: exaggeration }
	);
	const level = Math.sin((SUN.altitude * Math.PI) / 180) * 255;
	for (let o = 0; o < rgba.length; o += 4) {
		if (!rgba[o + 3]) continue;
		const v = rgba[o];
		const lit = v > level;
		rgba[o] = rgba[o + 1] = rgba[o + 2] = lit ? 255 : 0;
		rgba[o + 3] = lit ? ((v - level) / (255 - level)) * 255 : ((level - v) / level) * 255;
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
	return canvas.toDataURL('image/png');
}
