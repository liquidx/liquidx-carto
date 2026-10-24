/**
 * A classifier of Tessera embeddings into the label classes: logistic regression on each
 * pixel's embedding scaled to unit length, standardised, with the classes weighted to balance
 * and an L2 penalty (sklearn's `LogisticRegression(C, class_weight="balanced")` after a
 * `StandardScaler`), one class against the rest. Its strength is chosen by how well it does on
 * labels held out a whole area at a time. The model is a JSON file of 128 weights and a bias a
 * class, so classifying a pixel is a dot product a class: cheap enough to map a resort in the
 * browser.
 */
import type { LabelClass } from './classes.ts';
import { BANDS, isVersion, type TesseraVersion } from './store.ts';

/** Penalties tried, as sklearn's C: smaller is stronger. */
const STRENGTHS = [0.003, 0.01, 0.03, 0.1, 1];
const DEFAULT_C = 0.01;

/** Pixels to learn from: unit-length embeddings, row by row, with the class of each. */
export interface Samples {
	x: Float32Array;
	/** Index into the classes. */
	label: Uint8Array;
	/** The label each pixel came from: pixels of one area are held out together. */
	group: Int32Array;
	classes: number;
}

export interface CrossValidation {
	folds: number;
	accuracy: number;
	/** By class id: of the pixels called that class, how many were; of those that were, how many were called it. */
	classes: Record<string, { precision: number; recall: number }>;
}

export interface ClassifierModel {
	type: 'tessera-classifier-model';
	kind: 'logistic';
	store: string;
	version: TesseraVersion;
	year: number;
	c: number;
	/** What each row of weights picks out, as they were defined when it was trained. */
	classes: LabelClass[];
	/**
	 * One row a class: its score for a pixel's embedding e is bias + weights · e / |e|, and the
	 * chances of the classes are their sigmoids, scaled to sum to one.
	 */
	weights: number[][];
	bias: number[];
	/** Pixels learned from, by class id. */
	pixels: Record<string, number>;
	crossValidation: CrossValidation | null;
	labels: string[];
	trainedAt: string;
}

export const isModel = (v: unknown): v is ClassifierModel => {
	const m = v as ClassifierModel;
	return (
		m?.type === 'tessera-classifier-model' &&
		isVersion(m.version) &&
		Array.isArray(m.classes) &&
		m.classes.length >= 2 &&
		Array.isArray(m.weights) &&
		m.weights.length === m.classes.length &&
		m.weights.every((w) => w.length === BANDS)
	);
};

/** A small seeded generator, so a run picks the same pixels and folds each time. */
export function random(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Solves `a x = b` for a symmetric positive definite `a` (n × n, row by row), in place. */
function cholesky(a: Float64Array, b: Float64Array, n: number) {
	for (let j = 0; j < n; j++) {
		let d = a[j * n + j];
		for (let k = 0; k < j; k++) d -= a[j * n + k] * a[j * n + k];
		d = Math.sqrt(Math.max(d, 1e-12));
		a[j * n + j] = d;
		for (let i = j + 1; i < n; i++) {
			let v = a[i * n + j];
			for (let k = 0; k < j; k++) v -= a[i * n + k] * a[j * n + k];
			a[i * n + j] = v / d;
		}
	}
	for (let i = 0; i < n; i++) {
		let v = b[i];
		for (let k = 0; k < i; k++) v -= a[i * n + k] * b[k];
		b[i] = v / a[i * n + i];
	}
	for (let i = n - 1; i >= 0; i--) {
		let v = b[i];
		for (let k = i + 1; k < n; k++) v -= a[k * n + i] * b[k];
		b[i] = v / a[i * n + i];
	}
	return b;
}

/**
 * Fits one class against the rest over the pixels at `rows` by Newton's method, which takes a
 * handful of steps at 129 unknowns, and returns weights and a bias on the unstandardised
 * features.
 */
export function fitOne(samples: Samples, rows: ArrayLike<number>, positive: number, c: number) {
	const d = BANDS;
	const m = rows.length;
	const { x, label } = samples;
	const mean = new Float64Array(d);
	const sd = new Float64Array(d);
	let count = 0;
	for (let r = 0; r < m; r++) {
		const o = rows[r] * d;
		for (let k = 0; k < d; k++) mean[k] += x[o + k];
		if (label[rows[r]] === positive) count++;
	}
	for (let k = 0; k < d; k++) mean[k] /= m;
	for (let r = 0; r < m; r++) {
		const o = rows[r] * d;
		for (let k = 0; k < d; k++) sd[k] += (x[o + k] - mean[k]) ** 2;
	}
	for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k] / m) || 1;
	// Standardised, with a 1 on the end for the bias.
	const n = d + 1;
	const z = new Float64Array(m * n);
	for (let r = 0; r < m; r++) {
		const o = rows[r] * d;
		for (let k = 0; k < d; k++) z[r * n + k] = (x[o + k] - mean[k]) / sd[k];
		z[r * n + d] = 1;
	}
	// The class weighs as much as the rest, as `class_weight="balanced"`.
	const weightOf = [m / (2 * Math.max(1, m - count)), m / (2 * Math.max(1, count))];
	const y = new Float64Array(m);
	const sw = new Float64Array(m);
	for (let r = 0; r < m; r++) {
		y[r] = label[rows[r]] === positive ? 1 : 0;
		sw[r] = c * weightOf[y[r]];
	}

	const theta = new Float64Array(n);
	const loss = (th: Float64Array) => {
		let l = 0;
		for (let k = 0; k < d; k++) l += 0.5 * th[k] * th[k];
		for (let r = 0; r < m; r++) {
			let s = 0;
			for (let k = 0; k < n; k++) s += z[r * n + k] * th[k];
			// log(1 + e^s) - y s, without overflow.
			l += sw[r] * ((s > 0 ? s + Math.log1p(Math.exp(-s)) : Math.log1p(Math.exp(s))) - y[r] * s);
		}
		return l;
	};
	let current = loss(theta);
	for (let step = 0; step < 30; step++) {
		const grad = new Float64Array(n);
		const hess = new Float64Array(n * n);
		for (let k = 0; k < d; k++) {
			grad[k] = theta[k];
			hess[k * n + k] = 1;
		}
		for (let r = 0; r < m; r++) {
			const row = r * n;
			let s = 0;
			for (let k = 0; k < n; k++) s += z[row + k] * theta[k];
			const p = sigmoid(s);
			const g = sw[r] * (p - y[r]);
			const h = sw[r] * p * (1 - p);
			for (let i = 0; i < n; i++) {
				const zi = z[row + i];
				grad[i] += g * zi;
				const hz = h * zi;
				// The lower triangle: cholesky reads only that.
				for (let k = 0; k <= i; k++) hess[i * n + k] += hz * z[row + k];
			}
		}
		const delta = cholesky(hess, grad, n);
		// Halve the step until it helps, so a step past the minimum can't run away.
		let scale = 1;
		let next = theta.map((v, k) => v - delta[k]);
		let after = loss(next);
		while (after > current && scale > 1e-4) {
			scale /= 2;
			next = theta.map((v, k) => v - scale * delta[k]);
			after = loss(next);
		}
		theta.set(next);
		const moved = Math.max(...delta.map((v) => Math.abs(v * scale)));
		if (current - after < 1e-9 * (1 + Math.abs(current)) && moved < 1e-6) break;
		current = after;
	}
	const weights = Array.from({ length: d }, (_, k) => theta[k] / sd[k]);
	let bias = theta[d];
	for (let k = 0; k < d; k++) bias -= (theta[k] * mean[k]) / sd[k];
	return { weights, bias };
}

/**
 * Every class against the rest. Two classes are one fit: the second is the first turned
 * around, as a balanced fit of either against the other is.
 */
export function fit(samples: Samples, rows: ArrayLike<number>, c: number) {
	if (samples.classes === 2) {
		const { weights, bias } = fitOne(samples, rows, 0, c);
		return { weights: [weights, weights.map((w) => -w)], bias: [bias, -bias] };
	}
	const fits = Array.from({ length: samples.classes }, (_, k) => fitOne(samples, rows, k, c));
	return { weights: fits.map((f) => f.weights), bias: fits.map((f) => f.bias) };
}

/** The chance of each class for one unit-length embedding. */
export function probabilities(
	model: Pick<ClassifierModel, 'weights' | 'bias'>,
	x: ArrayLike<number>
) {
	const p = model.weights.map((w, c) => {
		let s = model.bias[c];
		for (let k = 0; k < BANDS; k++) s += w[k] * x[k];
		return sigmoid(s);
	});
	const sum = p.reduce((a, b) => a + b, 0);
	return p.map((v) => v / sum);
}

const argmax = (v: number[]) => v.reduce((best, x, i) => (x > v[best] ? i : best), 0);

/**
 * Folds of whole labels, each label's pixels in one fold, with every class spread across them
 * (as sklearn's `StratifiedGroupKFold`). Null when a class has fewer than two labels.
 */
export function folds(samples: Samples, most = 5): Int32Array[] | null {
	const classOf = new Map<number, number>();
	const size = new Map<number, number>();
	for (let i = 0; i < samples.group.length; i++) {
		classOf.set(samples.group[i], samples.label[i]);
		size.set(samples.group[i], (size.get(samples.group[i]) ?? 0) + 1);
	}
	const byClass = Array.from({ length: samples.classes }, (_, t) =>
		[...classOf].filter(([, c]) => c === t).map(([g]) => g)
	);
	const k = Math.min(most, ...byClass.map((g) => g.length));
	if (k < 2) return null;
	const rand = random(0);
	const foldOf = new Map<number, number>();
	for (const groups of byClass) {
		// Biggest first, each into the fold with the fewest pixels of the class so far.
		const shuffled = groups.map((g) => [g, rand()] as const).sort((a, b) => a[1] - b[1]);
		shuffled.sort((a, b) => size.get(b[0])! - size.get(a[0])!);
		const filled = new Array(k).fill(0);
		for (const [g] of shuffled) {
			const f = filled.indexOf(Math.min(...filled));
			foldOf.set(g, f);
			filled[f] += size.get(g)!;
		}
	}
	const out: number[][] = Array.from({ length: k }, () => []);
	for (let i = 0; i < samples.group.length; i++) out[foldOf.get(samples.group[i])!].push(i);
	return out.map((f) => Int32Array.from(f));
}

/** How a penalty does on each fold held out after fitting on the rest. */
export function crossValidate(
	samples: Samples,
	ids: string[],
	c: number,
	held: Int32Array[]
): CrossValidation {
	const predicted = new Uint8Array(samples.label.length);
	for (let f = 0; f < held.length; f++) {
		const rest = held.flatMap((rows, g) => (g === f ? [] : Array.from(rows)));
		const model = fit(samples, rest, c);
		for (const i of held[f])
			predicted[i] = argmax(probabilities(model, samples.x.subarray(i * BANDS, (i + 1) * BANDS)));
	}
	const round = (v: number) => Math.round(v * 1e4) / 1e4;
	let right = 0;
	const called = new Array(samples.classes).fill(0);
	const were = new Array(samples.classes).fill(0);
	const both = new Array(samples.classes).fill(0);
	for (let i = 0; i < predicted.length; i++) {
		called[predicted[i]]++;
		were[samples.label[i]]++;
		if (predicted[i] === samples.label[i]) {
			right++;
			both[predicted[i]]++;
		}
	}
	return {
		folds: held.length,
		accuracy: round(right / predicted.length),
		classes: Object.fromEntries(
			ids.map((id, k) => [
				id,
				{
					precision: called[k] ? round(both[k] / called[k]) : 0,
					recall: were[k] ? round(both[k] / were[k]) : 0
				}
			])
		)
	};
}

/**
 * Picks the penalty that does best on held-out labels (by the mean of the classes' recall, so
 * none wins by being common), then fits all the pixels with it.
 */
export function train(samples: Samples, ids: string[]) {
	const held = folds(samples);
	let best: { c: number; cv: CrossValidation; score: number } | null = null;
	if (held) {
		for (const c of STRENGTHS) {
			const cv = crossValidate(samples, ids, c, held);
			const recalls = Object.values(cv.classes).map((v) => v.recall);
			const score = recalls.reduce((a, b) => a + b, 0) / recalls.length;
			if (!best || score > best.score) best = { c, cv, score };
		}
	}
	const c = best?.c ?? DEFAULT_C;
	const all = Array.from({ length: samples.label.length }, (_, i) => i);
	return { ...fit(samples, all, c), c, crossValidation: best?.cv ?? null };
}
