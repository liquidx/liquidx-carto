/**
 * Labels to a model, and a model to a map, on Tessera embeddings: what `pnpm tessera-classifier`
 * and the /tessera-classifier page both run. The areas of each mapped class are written as the
 * scene's own features are, polygons of its `kind` (woods as `kind: wood`), with the chances as
 * an image and a comparison with the scene's features of that kind in the metadata, so the
 * dioramas and the labeller read them the same way whoever made them.
 */
import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';
import { zlibSync } from 'fflate';
import { simplify, traceLevelLines } from '../contour/contour.ts';
import { DEFAULT_CLASSES, classOf, type LabelClass } from './classes.ts';
import { random, train, type ClassifierModel, type Samples } from './model.ts';
import {
	BANDS,
	PIXEL,
	lonLatToPixel,
	pixelToLonLat,
	type Box,
	type Region,
	type TesseraStore
} from './store.ts';

export const DEFAULT_YEAR = 2025;
/** Pixels kept from each labelled area, so a big area doesn't drown out the rest. */
export const DEFAULT_PER_AREA = 400;
/** The smallest area, or hole inside one, that's kept, in m². */
export const DEFAULT_MIN_AREA = 600;
export const DEFAULT_THRESHOLD = 0.5;
/** Corners closer than this to the line between their neighbours are dropped, in pixels. */
const SIMPLIFY = 1;
/** Read past a label's edge by about 20 m, so a pixel it straddles is read whole. */
const PAD = 0.0002;

type Ring = Position[];
type Progress = (message: string) => void;

// ── pixels under shapes ────────────────────────────────

/**
 * The runs of pixels whose middles are inside the rings (even-odd, so holes are left out):
 * `fn(row, from, to)` for columns from…to-1. Rings are in pixel coordinates.
 */
export function spans(
	rings: Ring[],
	width: number,
	height: number,
	fn: (row: number, from: number, to: number) => void
) {
	let top = Infinity,
		bottom = -Infinity;
	for (const ring of rings)
		for (const [, v] of ring) {
			top = Math.min(top, v);
			bottom = Math.max(bottom, v);
		}
	const r0 = Math.max(0, Math.floor(top - 0.5));
	const r1 = Math.min(height - 1, Math.ceil(bottom - 0.5));
	const xs: number[] = [];
	for (let r = r0; r <= r1; r++) {
		const v = r + 0.5;
		xs.length = 0;
		for (const ring of rings)
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const [ua, va] = ring[j];
				const [ub, vb] = ring[i];
				if (va <= v !== vb <= v) xs.push(ua + ((v - va) * (ub - ua)) / (vb - va));
			}
		xs.sort((a, b) => a - b);
		for (let k = 0; k + 1 < xs.length; k += 2) {
			const from = Math.max(0, Math.ceil(xs[k] - 0.5));
			const to = Math.min(width, Math.ceil(xs[k + 1] - 0.5));
			if (to > from) fn(r, from, to);
		}
	}
}

const polygonsOf = (geometry: Feature['geometry']): Ring[][] =>
	geometry?.type === 'Polygon'
		? [geometry.coordinates]
		: geometry?.type === 'MultiPolygon'
			? geometry.coordinates
			: [];

/** 1 under every polygon of the features, on the region's grid. */
function maskOf(features: Feature[], region: Region) {
	const mask = new Uint8Array(region.width * region.height);
	for (const f of features)
		for (const polygon of polygonsOf(f.geometry)) {
			const rings = polygon.map((ring) => ring.map((p) => lonLatToPixel(region, p)));
			spans(rings, region.width, region.height, (r, a, b) =>
				mask.fill(1, r * region.width + a, r * region.width + b)
			);
		}
	return mask;
}

// ── train ──────────────────────────────────────────────

const boxOf = (rings: Ring[]): Box => {
	let w = Infinity,
		s = Infinity,
		e = -Infinity,
		n = -Infinity;
	for (const ring of rings)
		for (const [lon, lat] of ring) {
			w = Math.min(w, lon);
			s = Math.min(s, lat);
			e = Math.max(e, lon);
			n = Math.max(n, lat);
		}
	return [w - PAD, s - PAD, e + PAD, n + PAD];
};

/** A pixel's embedding at unit length, or false where it has none. */
function unit(region: Region, i: number, out: Float32Array, at: number) {
	if (!region.valid[i]) return false;
	const n = region.width * region.height;
	let sum = 0;
	for (let b = 0; b < BANDS; b++) sum += region.embeddings[b * n + i] ** 2;
	if (!sum) return false;
	const scale = 1 / Math.sqrt(sum);
	for (let b = 0; b < BANDS; b++) out[at + b] = region.embeddings[b * n + i] * scale;
	return true;
}

/** The classes the labels name, in the order of the list. */
export function labelledClasses(labels: Feature[], classes: LabelClass[]) {
	const named = new Set(labels.map((f) => classOf(f.properties?.label, classes)?.id));
	return classes.filter((c) => named.has(c.id));
}

/**
 * The pixels under labelled points and areas, each a `label` naming one of `classes`, at most
 * `perArea` from each area.
 */
export async function labelSamples(
	store: TesseraStore,
	labels: Feature[],
	classes: LabelClass[],
	opts: { year?: number; perArea?: number; onprogress?: Progress } = {}
): Promise<Samples> {
	const year = opts.year ?? DEFAULT_YEAR;
	const perArea = opts.perArea ?? DEFAULT_PER_AREA;
	const rand = random(0);
	const x: number[][] = [];
	const label: number[] = [];
	const group: number[] = [];
	const buffer = new Float32Array(BANDS);
	const keep = (region: Region, i: number, k: number, g: number) => {
		if (!unit(region, i, buffer, 0)) return false;
		x.push(Array.from(buffer));
		label.push(k);
		group.push(g);
		return true;
	};
	for (const [g, f] of labels.entries()) {
		const cls = classOf(f.properties?.label, classes);
		const k = classes.findIndex((c) => c.id === cls?.id);
		if (k < 0) continue;
		let kept = 0;
		if (f.geometry?.type === 'Point') {
			const region = await store.read(boxOf([[f.geometry.coordinates]]), year);
			const [u, v] = lonLatToPixel(region, f.geometry.coordinates);
			const i = Math.floor(v) * region.width + Math.floor(u);
			if (u >= 0 && v >= 0 && u < region.width && v < region.height && keep(region, i, k, g))
				kept = 1;
		} else {
			for (const polygon of polygonsOf(f.geometry)) {
				const region = await store.read(boxOf(polygon), year);
				const rings = polygon.map((ring) => ring.map((p) => lonLatToPixel(region, p)));
				const inside: number[] = [];
				spans(rings, region.width, region.height, (r, a, b) => {
					for (let c = a; c < b; c++) inside.push(r * region.width + c);
				});
				if (!inside.length) {
					// Smaller than a pixel: take the one under its middle.
					const [u, v] = rings[0].reduce(
						([su, sv], [pu, pv]) => [su + pu / rings[0].length, sv + pv / rings[0].length],
						[0, 0]
					);
					const c = Math.min(region.width - 1, Math.max(0, Math.floor(u)));
					const r = Math.min(region.height - 1, Math.max(0, Math.floor(v)));
					inside.push(r * region.width + c);
				}
				const valid = inside.filter((i) => region.valid[i]);
				// A seeded shuffle's first few, so a rerun learns from the same pixels.
				for (let n = 0; n < Math.min(perArea, valid.length); n++) {
					const j = n + Math.floor(rand() * (valid.length - n));
					[valid[n], valid[j]] = [valid[j], valid[n]];
					if (keep(region, valid[n], k, g)) kept++;
				}
			}
		}
		opts.onprogress?.(`label ${g + 1}/${labels.length}: ${kept} px ${classes[k].name}`);
	}
	const out = new Float32Array(x.length * BANDS);
	x.forEach((row, i) => out.set(row, i * BANDS));
	return {
		x: out,
		label: Uint8Array.from(label),
		group: Int32Array.from(group),
		classes: classes.length
	};
}

const tallyOf = (classes: LabelClass[], counts: number[]) =>
	classes.map((c, k) => `${counts[k]} ${c.name}`).join(', ');

/**
 * Labels to a model: reads the pixels under them, then picks and fits the classifier, for
 * every class with labels (two at least).
 */
export async function trainModel(
	store: TesseraStore,
	labels: Feature[],
	opts: {
		/** What the labels name. Default: the classes the classifier starts with. */
		classes?: LabelClass[];
		year?: number;
		perArea?: number;
		names?: string[];
		onprogress?: Progress;
	} = {}
): Promise<ClassifierModel> {
	const year = opts.year ?? DEFAULT_YEAR;
	const all = opts.classes ?? DEFAULT_CLASSES;
	const classes = labelledClasses(labels, all);
	if (classes.length < 2)
		throw new Error(`needs labels of two classes at least: ${all.map((c) => c.name).join(', ')}`);
	const labelCounts = classes.map(
		(c) => labels.filter((f) => classOf(f.properties?.label, classes)?.id === c.id).length
	);
	opts.onprogress?.(
		`${labelCounts.reduce((a, b) => a + b, 0)} labels: ${tallyOf(classes, labelCounts)}`
	);
	const samples = await labelSamples(store, labels, classes, { ...opts, year });
	const pixels = classes.map((_, k) => samples.label.filter((l) => l === k).length);
	const missing = classes.filter((_, k) => !pixels[k]);
	if (missing.length)
		throw new Error(
			`no ${year} embeddings under the ${missing.map((c) => c.name).join(', ')} labels`
		);
	opts.onprogress?.(`${samples.label.length} pixels: ${tallyOf(classes, pixels)}`);
	const ids = classes.map((c) => c.id);
	const fitted = train(samples, ids);
	const round = (v: number) => Math.round(v * 1e6) / 1e6;
	return {
		type: 'tessera-classifier-model',
		kind: 'logistic',
		store: store.url,
		version: store.version,
		year,
		c: fitted.c,
		classes,
		weights: fitted.weights.map((w) => w.map(round)),
		bias: fitted.bias.map(round),
		pixels: Object.fromEntries(ids.map((id, k) => [id, pixels[k]])),
		crossValidation: fitted.crossValidation,
		labels: opts.names ?? [],
		trainedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
	};
}

// ── predict ────────────────────────────────────────────

/** The chance of each of the model's classes for every pixel of the region, NaN where it has no embedding. */
export function probabilities(model: ClassifierModel, region: Region) {
	const n = region.width * region.height;
	const k = model.classes.length;
	const scores = Array.from({ length: k }, () => new Float64Array(n));
	const norm = new Float64Array(n);
	for (let b = 0; b < BANDS; b++) {
		const band = region.embeddings.subarray(b * n, (b + 1) * n);
		for (let i = 0; i < n; i++) norm[i] += band[i] * band[i];
		for (let c = 0; c < k; c++) {
			const w = model.weights[c][b];
			const s = scores[c];
			for (let i = 0; i < n; i++) s[i] += w * band[i];
		}
	}
	const out = Array.from({ length: k }, () => new Float32Array(n));
	for (let i = 0; i < n; i++) {
		if (!region.valid[i] || !norm[i]) {
			for (let c = 0; c < k; c++) out[c][i] = NaN;
			continue;
		}
		const length = Math.sqrt(norm[i]);
		let sum = 0;
		for (let c = 0; c < k; c++) {
			const p = 1 / (1 + Math.exp(-(model.bias[c] + scores[c][i] / length)));
			out[c][i] = p;
			sum += p;
		}
		for (let c = 0; c < k; c++) out[c][i] /= sum;
	}
	return out;
}

const ringArea = (ring: Ring) => {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
		sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
	return sum / 2;
};

function inRing([u, v]: Position, ring: Ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [ua, va] = ring[j];
		const [ub, vb] = ring[i];
		if (va <= v !== vb <= v && u < ua + ((v - va) * (ub - ua)) / (vb - va)) inside = !inside;
	}
	return inside;
}

/**
 * The outlines where a class's chance crosses the threshold, as polygons in pixel
 * coordinates: areas and the holes in them smaller than `minPx` pixels are dropped, as a sieve
 * would.
 */
export function traceAreas(
	p: Float32Array,
	width: number,
	height: number,
	threshold: number,
	minPx: number
) {
	// A border of none all round closes every line.
	const w = width + 2;
	const data = new Float32Array(w * (height + 2));
	for (let r = 0; r < height; r++)
		for (let c = 0; c < width; c++) {
			const v = p[r * width + c];
			data[(r + 1) * w + c + 1] = Number.isNaN(v) ? 0 : v;
		}
	const rings = traceLevelLines({ width: w, height: height + 2, data }, threshold)
		.map((line) => {
			const s = simplify(line, SIMPLIFY);
			const ring: Ring = [];
			// Grid point (i, j) is the middle of pixel (i - 1, j - 1).
			for (let k = 0; k < s.length; k += 2) ring.push([s[k] - 0.5, s[k + 1] - 0.5]);
			return ring;
		})
		.filter((ring) => ring.length >= 4)
		.map((ring) => {
			let u0 = Infinity,
				v0 = Infinity,
				u1 = -Infinity,
				v1 = -Infinity;
			for (const [u, v] of ring) {
				u0 = Math.min(u0, u);
				v0 = Math.min(v0, v);
				u1 = Math.max(u1, u);
				v1 = Math.max(v1, v);
			}
			return { ring, area: Math.abs(ringArea(ring)), box: [u0, v0, u1, v1], depth: 0, parent: -1 };
		})
		.sort((a, b) => b.area - a.area);

	// Each ring sits inside the smallest bigger ring holding it: areas at even depths (the
	// border is outside them), holes at odd.
	for (let i = 0; i < rings.length; i++) {
		const a = rings[i];
		for (let j = i - 1; j >= 0; j--) {
			const b = rings[j];
			if (a.box[0] < b.box[0] || a.box[1] < b.box[1] || a.box[2] > b.box[2] || a.box[3] > b.box[3])
				continue;
			if (inRing(a.ring[0], b.ring)) {
				a.parent = j;
				a.depth = b.depth + 1;
				break;
			}
		}
	}
	const areas = new Map<number, { outer: Ring; holes: Ring[]; areaPx: number }>();
	for (const [i, r] of rings.entries()) {
		if (r.area < minPx) continue;
		if (r.depth % 2 === 0) areas.set(i, { outer: r.ring, holes: [], areaPx: r.area });
		else {
			const area = areas.get(r.parent);
			if (area) {
				area.holes.push(r.ring);
				area.areaPx -= r.area;
			}
		}
	}
	return [...areas.values()];
}

/** Clips a lon/lat ring to a box (Sutherland–Hodgman), which a ring can't leave convex. */
function clipRing(ring: Ring, [w, s, e, n]: Box): Ring {
	const edges: [(p: Position) => boolean, (a: Position, b: Position) => Position][] = [
		[(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
		[(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
		[(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
		[(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]]
	];
	let out = ring.slice(0, -1);
	for (const [inside, cross] of edges) {
		const input = out;
		out = [];
		for (let i = 0; i < input.length; i++) {
			const a = input[(i + input.length - 1) % input.length];
			const b = input[i];
			if (inside(b)) {
				if (!inside(a)) out.push(cross(a, b));
				out.push(b);
			} else if (inside(a)) out.push(cross(a, b));
		}
		if (!out.length) return [];
	}
	return out.length >= 3 ? [...out, out[0]] : [];
}

const round6 = (p: Position): Position => [
	Math.round(p[0] * 1e6) / 1e6,
	Math.round(p[1] * 1e6) / 1e6
];

/** CRC-32 as PNG chunks use it. */
const CRC = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

/** RGBA pixels as a PNG data URL, in the browser or Node alike. */
export function pngDataUrl(rgba: Uint8Array, width: number, height: number) {
	const raw = new Uint8Array((width * 4 + 1) * height);
	for (let r = 0; r < height; r++)
		raw.set(rgba.subarray(r * width * 4, (r + 1) * width * 4), r * (width * 4 + 1) + 1);
	const chunk = (type: string, data: Uint8Array) => {
		const out = new Uint8Array(data.length + 12);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
		out.set(data, 8);
		let c = 0xffffffff;
		for (let i = 4; i < data.length + 8; i++) c = CRC[(c ^ out[i]) & 0xff] ^ (c >>> 8);
		view.setUint32(data.length + 8, (c ^ 0xffffffff) >>> 0);
		return out;
	};
	const header = new Uint8Array(13);
	const hv = new DataView(header.buffer);
	hv.setUint32(0, width);
	hv.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	const parts = [
		Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', zlibSync(raw, { level: 9 })),
		chunk('IEND', new Uint8Array())
	];
	let binary = '';
	for (const part of parts)
		for (let i = 0; i < part.length; i += 0x8000)
			binary += String.fromCharCode(...part.subarray(i, i + 0x8000));
	return `data:image/png;base64,${btoa(binary)}`;
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * The chances of the mapped classes as an image, each pixel in the colour of its likeliest,
 * fading out below an even chance, with its corners in lon/lat for a MapLibre image source: top
 * left, top right, bottom right, bottom left.
 */
function overlay(p: Float32Array[], classes: LabelClass[], region: Region) {
	const { width, height } = region;
	const mapped = classes.flatMap((c, k) => (c.kind ? [k] : []));
	const colors = classes.map((c) => rgbOf(c.color));
	const rgba = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		let best = -1;
		for (const k of mapped) if (best < 0 || p[k][i] > p[best][i]) best = k;
		const v = best < 0 ? NaN : p[best][i];
		const a = Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, (v - 0.3) / 0.7));
		if (a) rgba.set([...colors[best], Math.floor(a * 220)], i * 4);
	}
	const corners = [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height]
	].map((q) => round6(pixelToLonLat(region, q)));
	return {
		image: pngDataUrl(rgba, width, height),
		coordinates: corners as [Position, Position, Position, Position]
	};
}

/** How a mapped class's areas compare with the scene's features of its kind, as shares of the square. */
export interface ClassStats {
	cover: number;
	sceneCover: number;
	/** Pixels both call the same. */
	agreement: number;
	iou: number | null;
	/** Found where the scene has none. */
	outsideScene: number;
	/** In the scene where none was found. */
	sceneWithout: number;
}

export interface PredictOptions {
	/** Default: the scene's `metadata.bounds`. */
	bounds?: Box;
	/** Default: the year the model was trained on. */
	year?: number;
	threshold?: number;
	minArea?: number;
	/** What the result's `source` names the model by. */
	modelName?: string;
	onprogress?: Progress;
}

/**
 * A model run over a scene's square: the areas of each mapped class, as scene features of its
 * kind, and how they compare with the scene's own.
 */
export async function predict(
	store: TesseraStore,
	model: ClassifierModel,
	scene: FeatureCollection & { metadata?: { bounds?: Box } },
	opts: PredictOptions = {}
) {
	const bounds = opts.bounds ?? scene.metadata?.bounds;
	if (!bounds) throw new Error('the scene has no metadata.bounds: give the bounds to cover');
	if (model.version !== store.version)
		throw new Error(`the model is of tessera ${model.version}, the store ${store.version}`);
	const year = opts.year ?? model.year;
	const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
	const minArea = opts.minArea ?? DEFAULT_MIN_AREA;
	const region = await store.read(bounds, year, (done, total) =>
		opts.onprogress?.(`reading embeddings: ${Math.round((done / total) * 100)}%`)
	);
	const p = probabilities(model, region);
	const { width, height, valid } = region;
	let validCount = 0;
	for (const v of valid) validCount += v;
	if (!validCount) throw new Error(`no embeddings over the scene in ${year}`);

	const minPx = Math.max(1, Math.round(minArea / (PIXEL * PIXEL)));
	const features: Feature<Polygon>[] = [];
	const stats: Record<string, ClassStats> = {};
	for (const [k, cls] of model.classes.entries()) {
		if (!cls.kind) continue;
		const mask = new Uint8Array(width * height);
		const areas = traceAreas(p[k], width, height, threshold, minPx)
			.map((area) => {
				let sum = 0,
					count = 0;
				spans([area.outer, ...area.holes], width, height, (r, a, b) => {
					mask.fill(1, r * width + a, r * width + b);
					for (let i = r * width + a; i < r * width + b; i++)
						if (!Number.isNaN(p[k][i])) {
							sum += p[k][i];
							count++;
						}
				});
				return { ...area, confidence: count ? sum / count : 0 };
			})
			.sort((a, b) => b.areaPx - a.areaPx);
		let n = 0;
		for (const area of areas) {
			const toLonLat = (ring: Ring, outer: boolean) => {
				const clipped = clipRing(
					ring.map((q) => round6(pixelToLonLat(region, q))),
					bounds
				);
				// GeoJSON's winding: outer rings anticlockwise, holes clockwise.
				return outer === ringArea(clipped) > 0 ? clipped : clipped.reverse();
			};
			const outer = toLonLat(area.outer, true);
			if (!outer.length) continue;
			const holes = area.holes.map((h) => toLonLat(h, false)).filter((h) => h.length);
			features.push({
				type: 'Feature',
				properties: {
					kind: cls.kind,
					class: cls.id,
					id: `tessera:${cls.id}:${n++}`,
					source: 'tessera',
					areaM2: Math.round(area.areaPx * PIXEL * PIXEL),
					confidence: Math.round(area.confidence * 1000) / 1000
				},
				geometry: { type: 'Polygon', coordinates: [outer, ...holes] }
			});
		}

		const ours = maskOf(
			scene.features.filter((f) => f.properties?.kind === cls.kind),
			region
		);
		let found = 0,
			theirs = 0,
			both = 0,
			either = 0,
			same = 0,
			foundOnly = 0,
			theirsOnly = 0;
		for (let i = 0; i < mask.length; i++) {
			if (!valid[i]) continue;
			const t = mask[i],
				o = ours[i];
			found += t;
			theirs += o;
			both += t & o;
			either += t | o;
			same += t === o ? 1 : 0;
			foundOnly += t & (1 - o);
			theirsOnly += o & (1 - t);
		}
		const share = (v: number) => Math.round((v / validCount) * 1e4) / 1e4;
		stats[cls.id] = {
			cover: share(found),
			sceneCover: share(theirs),
			agreement: share(same),
			iou: either ? Math.round((both / either) * 1e4) / 1e4 : null,
			outsideScene: share(foundOnly),
			sceneWithout: share(theirsOnly)
		};
	}

	const source = `geotessera ${model.version} ${year}, ${model.kind} model${opts.modelName ? ` ${opts.modelName}` : ''}`;
	return {
		type: 'FeatureCollection' as const,
		metadata: {
			source,
			exportedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
			bounds,
			threshold,
			classes: model.classes,
			featureCount: features.length,
			stats,
			probability: overlay(p, model.classes, region)
		},
		features
	};
}

export type PredictResult = Awaited<ReturnType<typeof predict>>;

/** The scene with its features of each mapped kind swapped for the ones found, for the dioramas. */
export function withPrediction(
	scene: FeatureCollection & { metadata?: object },
	result: PredictResult
) {
	const kinds = new Set(result.metadata.classes.flatMap((c) => (c.kind ? [c.kind] : [])));
	const rest = scene.features.filter((f) => !kinds.has(f.properties?.kind));
	return {
		type: 'FeatureCollection' as const,
		metadata: {
			...scene.metadata,
			tessera: { source: result.metadata.source, kinds: [...kinds] },
			featureCount: rest.length + result.features.length
		},
		features: [...result.features, ...rest]
	};
}
