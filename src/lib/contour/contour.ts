/**
 * Contour tracing on a regular elevation grid.
 *
 * Grid point (i, j) sits at output coordinate (i * sx, j * sy), so the first and last rows and
 * columns land exactly on the frame edges. Lines are traced with marching squares, stitched into
 * polylines across cells (open at the frame edge or around nodata, closed otherwise) and
 * simplified with Douglas–Peucker.
 */

export interface Grid {
	width: number;
	height: number;
	/** Row-major, first row is the top (north) edge. NaN = no data. */
	data: Float32Array;
}

export interface GridStats {
	min: number;
	max: number;
	/** Fraction of grid points without data. */
	nodata: number;
}

export interface ContourOptions {
	/** Contour interval in metres. */
	interval: number;
	/** Every Nth contour (counting from 0 m) is a major (index) contour. */
	majorEvery: number;
	/** Gaussian smoothing sigma in grid cells, 0 disables. */
	smoothing: number;
	/** Output size the grid is stretched over. */
	outWidth: number;
	outHeight: number;
	/** Skip contours below 0 m (sea floor). */
	skipBelowSea: boolean;
	/** Douglas–Peucker tolerance in output units. */
	tolerance: number;
}

export interface ContourLevel {
	value: number;
	major: boolean;
	/** Polylines as flat [x0, y0, x1, y1, …] arrays in output coordinates. */
	lines: Float32Array[];
}

export function gridStats(grid: Grid): GridStats {
	let min = Infinity;
	let max = -Infinity;
	let missing = 0;
	for (const v of grid.data) {
		if (Number.isNaN(v)) missing++;
		else {
			if (v < min) min = v;
			if (v > max) max = v;
		}
	}
	if (!Number.isFinite(min)) min = max = 0;
	return { min, max, nodata: grid.data.length ? missing / grid.data.length : 1 };
}

const NICE_INTERVALS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
export { NICE_INTERVALS };

/** Pick a round interval giving roughly `target` contours over the relief. */
export function autoInterval(relief: number, target = 40): number {
	const raw = relief / target;
	return NICE_INTERVALS.find((n) => n >= raw) ?? NICE_INTERVALS[NICE_INTERVALS.length - 1];
}

/**
 * Separable Gaussian blur that ignores NaN (normalised convolution). NaN points stay NaN so
 * nodata areas keep their shape.
 */
export function blur(grid: Grid, sigma: number): Grid {
	if (sigma <= 0) return grid;
	const { width: w, height: h, data } = grid;
	const r = Math.max(1, Math.ceil(sigma * 3));
	const kernel = new Float32Array(2 * r + 1);
	for (let k = -r; k <= r; k++) kernel[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma));

	const pass = (src: Float32Array, horizontal: boolean) => {
		const out = new Float32Array(src.length);
		const len = horizontal ? w : h;
		const lines = horizontal ? h : w;
		const stride = horizontal ? 1 : w;
		const lineStride = horizontal ? w : 1;
		for (let l = 0; l < lines; l++) {
			const base = l * lineStride;
			for (let i = 0; i < len; i++) {
				const centre = src[base + i * stride];
				if (Number.isNaN(centre)) {
					out[base + i * stride] = NaN;
					continue;
				}
				let sum = 0;
				let wsum = 0;
				const k0 = Math.max(-r, -i);
				const k1 = Math.min(r, len - 1 - i);
				for (let k = k0; k <= k1; k++) {
					const v = src[base + (i + k) * stride];
					if (Number.isNaN(v)) continue;
					const kw = kernel[k + r];
					sum += v * kw;
					wsum += kw;
				}
				out[base + i * stride] = sum / wsum;
			}
		}
		return out;
	};

	return { width: w, height: h, data: pass(pass(data, true), false) };
}

/** Contour levels (multiples of `interval`) that fall strictly inside the data range. */
export function levelRange(stats: GridStats, opts: ContourOptions): { k0: number; k1: number } {
	const lo = opts.skipBelowSea ? Math.max(0, stats.min) : stats.min;
	// A level t crosses a cell when min < t <= max (corners are classified as v >= t).
	let k0 = Math.floor(lo / opts.interval) + 1;
	if (opts.skipBelowSea && stats.min < 0 && k0 > 0) k0 = 0;
	const k1 = Math.floor(stats.max / opts.interval);
	return { k0, k1 };
}

/**
 * Trace every contour level. Cells are bucketed by the levels they span first, so each level
 * only visits the cells it actually crosses.
 */
export function traceContours(grid: Grid, opts: ContourOptions): ContourLevel[] {
	const { width: w, height: h, data } = grid;
	if (w < 2 || h < 2 || !(opts.interval > 0)) return [];
	const stats = gridStats(grid);
	const { k0, k1 } = levelRange(stats, opts);
	const nLevels = k1 - k0 + 1;
	if (nLevels <= 0) return [];
	const cw = w - 1;
	const ch = h - 1;
	const interval = opts.interval;

	// Pass 1: count cells per level. Pass 2: fill buckets (counting sort).
	const counts = new Uint32Array(nLevels + 1);
	const cellLo = new Int32Array(cw * ch);
	const cellHi = new Int32Array(cw * ch);
	for (let j = 0; j < ch; j++) {
		for (let i = 0; i < cw; i++) {
			const c = j * cw + i;
			const a = data[j * w + i];
			const b = data[j * w + i + 1];
			const cc = data[(j + 1) * w + i + 1];
			const d = data[(j + 1) * w + i];
			if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(cc) || Number.isNaN(d)) {
				cellLo[c] = 1;
				cellHi[c] = 0;
				continue;
			}
			const mn = Math.min(a, b, cc, d);
			const mx = Math.max(a, b, cc, d);
			// levels k with mn < k*interval <= mx
			const lo = Math.max(k0, Math.floor(mn / interval) + 1) - k0;
			const hi = Math.min(k1, Math.floor(mx / interval)) - k0;
			cellLo[c] = lo;
			cellHi[c] = hi;
			for (let k = lo; k <= hi; k++) counts[k + 1]++;
		}
	}
	for (let k = 0; k < nLevels; k++) counts[k + 1] += counts[k];
	const offsets = counts.slice();
	const buckets = new Uint32Array(counts[nLevels]);
	for (let c = 0; c < cw * ch; c++) {
		for (let k = cellLo[c]; k <= cellHi[c]; k++) buckets[offsets[k]++] = c;
	}

	const sx = opts.outWidth / cw;
	const sy = opts.outHeight / ch;
	const levels: ContourLevel[] = [];
	for (let k = 0; k < nLevels; k++) {
		const kk = k + k0;
		const t = kk * interval;
		const cells = buckets.subarray(counts[k], counts[k + 1]);
		const lines = traceLevel(data, w, cells, t, sx, sy).map((l) => simplify(l, opts.tolerance));
		const major = opts.majorEvery > 0 && kk % opts.majorEvery === 0;
		levels.push({ value: t, major, lines });
	}
	return levels;
}

// Edge ids: horizontal edge from (i, j) to (i+1, j) is 2*(j*w+i); vertical edge from (i, j) to
// (i, j+1) is 2*(j*w+i)+1. Every crossing point lives on exactly one edge, shared by ≤ 2 cells.

/**
 * Segments per marching-squares case, as pairs of cell sides: 0 top, 1 right, 2 bottom, 3 left.
 * Case bits: 8 = top-left, 4 = top-right, 2 = bottom-right, 1 = bottom-left (set when v >= t).
 */
const CASES: number[][] = [
	[],
	[3, 2],
	[2, 1],
	[3, 1],
	[1, 0],
	[], // saddle, resolved below
	[2, 0],
	[3, 0],
	[0, 3],
	[0, 2],
	[], // saddle
	[0, 1],
	[1, 3],
	[1, 2],
	[2, 3],
	[]
];

function traceLevel(
	data: Float32Array,
	w: number,
	cells: Uint32Array,
	t: number,
	sx: number,
	sy: number
): Float32Array[] {
	const cw = w - 1;
	// Adjacency of crossing points: edge id -> up to two neighbouring edge ids.
	const next = new Map<number, number[]>();
	const point = new Map<number, [number, number]>();

	const edgePoint = (i: number, j: number, side: number): number => {
		// Resolve a cell side to a global edge and compute its crossing once.
		let id: number, ia: number, ja: number, ib: number, jb: number;
		if (side === 0) [id, ia, ja, ib, jb] = [2 * (j * w + i), i, j, i + 1, j];
		else if (side === 2) [id, ia, ja, ib, jb] = [2 * ((j + 1) * w + i), i, j + 1, i + 1, j + 1];
		else if (side === 3) [id, ia, ja, ib, jb] = [2 * (j * w + i) + 1, i, j, i, j + 1];
		else [id, ia, ja, ib, jb] = [2 * (j * w + i + 1) + 1, i + 1, j, i + 1, j + 1];
		if (!point.has(id)) {
			const va = data[ja * w + ia];
			const vb = data[jb * w + ib];
			const f = vb === va ? 0.5 : (t - va) / (vb - va);
			point.set(id, [(ia + (ib - ia) * f) * sx, (ja + (jb - ja) * f) * sy]);
		}
		return id;
	};

	const link = (a: number, b: number) => {
		const na = next.get(a);
		if (na) na.push(b);
		else next.set(a, [b]);
		const nb = next.get(b);
		if (nb) nb.push(a);
		else next.set(b, [a]);
	};

	for (const c of cells) {
		const i = c % cw;
		const j = (c - i) / cw;
		const tl = data[j * w + i];
		const tr = data[j * w + i + 1];
		const br = data[(j + 1) * w + i + 1];
		const bl = data[(j + 1) * w + i];
		const code = (tl >= t ? 8 : 0) | (tr >= t ? 4 : 0) | (br >= t ? 2 : 0) | (bl >= t ? 1 : 0);
		let segs = CASES[code];
		if (code === 5 || code === 10) {
			const centreHigh = (tl + tr + br + bl) / 4 >= t;
			// 5 = TR & BL high, 10 = TL & BR high.
			if (code === 5) segs = centreHigh ? [3, 0, 1, 2] : [3, 2, 1, 0];
			else segs = centreHigh ? [0, 1, 2, 3] : [0, 3, 2, 1];
		}
		for (let s = 0; s < segs.length; s += 2) {
			link(edgePoint(i, j, segs[s]), edgePoint(i, j, segs[s + 1]));
		}
	}

	// Walk chains: open ends (degree 1) first, then whatever remains is closed loops.
	const visited = new Set<number>();
	const lines: Float32Array[] = [];
	const walk = (start: number) => {
		const coords: number[] = [];
		let prev = -1;
		let cur = start;
		while (cur !== undefined && !visited.has(cur)) {
			visited.add(cur);
			const [x, y] = point.get(cur)!;
			coords.push(x, y);
			const nb = next.get(cur)!;
			const nxt: number | undefined = nb[0] !== prev ? nb[0] : nb[1];
			prev = cur;
			cur = nxt as number;
		}
		// Close loops by repeating the first point.
		if (cur === start && coords.length > 4) coords.push(coords[0], coords[1]);
		if (coords.length >= 4) lines.push(Float32Array.from(coords));
	};
	for (const [id, nb] of next) if (nb.length === 1 && !visited.has(id)) walk(id);
	for (const id of next.keys()) if (!visited.has(id)) walk(id);
	return lines;
}

/** Douglas–Peucker simplification of a flat [x, y, …] polyline. */
export function simplify(line: Float32Array, tolerance: number): Float32Array {
	const n = line.length / 2;
	if (n <= 2 || tolerance <= 0) return line;
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const tol2 = tolerance * tolerance;
	const stack: number[] = [0, n - 1];
	while (stack.length) {
		const b = stack.pop()!;
		const a = stack.pop()!;
		const ax = line[2 * a],
			ay = line[2 * a + 1];
		const dx = line[2 * b] - ax,
			dy = line[2 * b + 1] - ay;
		const len2 = dx * dx + dy * dy;
		let maxD = -1;
		let idx = -1;
		for (let i = a + 1; i < b; i++) {
			const px = line[2 * i] - ax,
				py = line[2 * i + 1] - ay;
			let d2: number;
			if (len2 === 0) d2 = px * px + py * py;
			else {
				const cross = px * dy - py * dx;
				d2 = (cross * cross) / len2;
			}
			if (d2 > maxD) {
				maxD = d2;
				idx = i;
			}
		}
		if (maxD > tol2) {
			keep[idx] = 1;
			stack.push(a, idx, idx, b);
		}
	}
	let m = 0;
	for (let i = 0; i < n; i++) m += keep[i];
	const out = new Float32Array(m * 2);
	for (let i = 0, o = 0; i < n; i++) {
		if (!keep[i]) continue;
		out[o++] = line[2 * i];
		out[o++] = line[2 * i + 1];
	}
	return out;
}

/** SVG path data for a set of polylines, rounded to 0.1 output units. */
export function toPathData(lines: Float32Array[]): string {
	const parts: string[] = [];
	for (const l of lines) {
		let s = `M${r1(l[0])} ${r1(l[1])}`;
		for (let i = 2; i < l.length; i += 2) s += `L${r1(l[i])} ${r1(l[i + 1])}`;
		parts.push(s);
	}
	return parts.join('');
}

function r1(v: number) {
	return Math.round(v * 10) / 10;
}
