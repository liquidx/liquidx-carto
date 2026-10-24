/**
 * A classifier of Tessera embeddings. Run `pnpm tessera-classifier help`.
 *
 * `train` reads the embeddings under the labels drawn on /tessera-classifier and fits a
 * classifier of their classes (woods against open ground, by default); `predict` maps where a
 * model finds each mapped class over a scene's square and writes them as scene features (woods
 * as `kind: wood`), beside the scene. Both run the code the page runs in the browser
 * (src/lib/tessera), reading the public store directly, with what's read kept in
 * data/tessera-classifier/zarr-cache so a second run over the same ground is quick.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Feature, FeatureCollection } from 'geojson';
import {
	DEFAULT_CLASSES,
	classesForLabels,
	isClass,
	mergeClasses,
	type LabelClass
} from '../src/lib/tessera/classes.ts';
import { isModel } from '../src/lib/tessera/model.ts';
import {
	DEFAULT_VERSION,
	TESSERA_RELEASES,
	TesseraStore,
	isVersion,
	type Box,
	type ByteCache
} from '../src/lib/tessera/store.ts';
import {
	DEFAULT_MIN_AREA,
	DEFAULT_PER_AREA,
	DEFAULT_THRESHOLD,
	DEFAULT_YEAR,
	predict,
	trainModel,
	withPrediction
} from '../src/lib/tessera/classify.ts';

const OUT_DIR = join('data', 'tessera-classifier');
const CACHE_DIR = join(OUT_DIR, 'zarr-cache');
const DEFAULT_MODEL = join(OUT_DIR, 'model.json');

const fileCache: ByteCache = {
	async get(key) {
		try {
			return new Uint8Array(await readFile(cachePath(key)));
		} catch {
			return undefined;
		}
	},
	async set(key, bytes) {
		await mkdir(CACHE_DIR, { recursive: true });
		await writeFile(cachePath(key), bytes);
	}
};
const cachePath = (key: string) =>
	join(CACHE_DIR, createHash('sha1').update(key).digest('hex') + '.bin');

async function readJson(source: string) {
	if (/^https?:\/\//.test(source)) {
		const response = await fetch(source);
		if (!response.ok) throw new Error(`${source}: ${response.status}`);
		return response.json();
	}
	return JSON.parse(await readFile(source, 'utf8'));
}

/** `<name>-tessera.geojson` beside a scene file, or in data/ for a URL. */
function defaultOutput(source: string) {
	const stem = basename(source.split('?')[0])
		.replace(/\.geojson$/, '')
		.replace(/-scene$/, '');
	const dir = /^https?:\/\//.test(source) ? OUT_DIR : dirname(source);
	return join(dir, `${stem}-tessera.geojson`);
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		output: { type: 'string', short: 'o' },
		model: { type: 'string', short: 'm', default: DEFAULT_MODEL },
		year: { type: 'string' },
		version: { type: 'string', default: DEFAULT_VERSION },
		'per-area': { type: 'string', default: String(DEFAULT_PER_AREA) },
		'scene-out': { type: 'string' },
		threshold: { type: 'string', default: String(DEFAULT_THRESHOLD) },
		'min-area': { type: 'string', default: String(DEFAULT_MIN_AREA) },
		bbox: { type: 'string' }
	}
});
const [command = 'help', ...sources] = positionals;
const storeFor = (version: string) => {
	if (!isVersion(version))
		throw new Error(`--version is one of ${Object.keys(TESSERA_RELEASES).join(', ')}`);
	return new TesseraStore({ version, cache: fileCache });
};

if (command === 'train' && sources.length) {
	// The classes are the ones the files define, or the ones the classifier starts with.
	const labels: Feature[] = [];
	const defined: LabelClass[][] = [];
	for (const source of sources) {
		const file = (await readJson(source)) as FeatureCollection & {
			metadata?: { classes?: unknown };
		};
		labels.push(...file.features);
		if (Array.isArray(file.metadata?.classes)) defined.push(file.metadata.classes.filter(isClass));
	}
	const classes = classesForLabels(
		labels.flatMap((f) => (typeof f.properties?.label === 'string' ? [f.properties.label] : [])),
		defined.length ? mergeClasses([], ...defined) : DEFAULT_CLASSES
	);
	const model = await trainModel(storeFor(opts.version!), labels, {
		classes,
		year: opts.year ? Number(opts.year) : DEFAULT_YEAR,
		perArea: Number(opts['per-area']),
		names: sources,
		onprogress: (m) => console.log(`  ${m}`)
	});
	const cv = model.crossValidation;
	if (cv) {
		console.log(
			`held out by area (${cv.folds} folds): accuracy ${pct(cv.accuracy)}, at C ${model.c}`
		);
		for (const c of model.classes)
			console.log(
				`  ${c.name}: precision ${pct(cv.classes[c.id].precision)}, recall ${pct(cv.classes[c.id].recall)}`
			);
	} else console.log('too few areas of each class to hold any out: label at least two of each');
	const output = opts.output ?? DEFAULT_MODEL;
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, JSON.stringify(model, null, '\t'));
	console.log(`model → ${output}`);
} else if (command === 'predict' && sources.length === 1) {
	const [source] = sources;
	const model = await readJson(opts.model!);
	if (!isModel(model))
		throw new Error(`${opts.model} is not a model from \`pnpm tessera-classifier train\``);
	const scene = await readJson(source);
	const bounds = opts.bbox ? (opts.bbox.split(/[ ,]+/).map(Number) as Box) : undefined;
	const result = await predict(storeFor(model.version), model, scene, {
		bounds,
		year: opts.year ? Number(opts.year) : undefined,
		threshold: Number(opts.threshold),
		minArea: Number(opts['min-area']),
		modelName: basename(opts.model!),
		onprogress: (m) => process.stdout.write(`\r  ${m}`)
	});
	process.stdout.write('\n');
	for (const c of model.classes) {
		const s = result.metadata.stats[c.id];
		if (!s) continue;
		console.log(
			`${c.name} cover ${pct(s.cover)} of the scene, its ${c.kind} features ${pct(s.sceneCover)}; they agree on ${pct(s.agreement)} of pixels (iou ${(s.iou ?? 0).toFixed(2)})`
		);
		console.log(
			`  found outside the scene's ${pct(s.outsideScene)}, the scene's without any found ${pct(s.sceneWithout)}`
		);
	}
	const output = opts.output ?? defaultOutput(source);
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, JSON.stringify(result));
	console.log(`${result.features.length} areas → ${output}`);
	if (opts['scene-out']) {
		await writeFile(opts['scene-out'], JSON.stringify(withPrediction(scene, result)));
		console.log(`scene with them in place of its own → ${opts['scene-out']}`);
	}
} else {
	console.log(`usage: pnpm tessera-classifier train labels.geojson [more.geojson …] [-o model.json]
       pnpm tessera-classifier predict scene.geojson [-m model.json] [-o out.geojson] [--scene-out x-scene.geojson]

  train    read the embeddings under the labels exported from /tessera-classifier and fit a
           classifier of the classes they name (from the files, or ${DEFAULT_CLASSES.map((c) => c.id).join(', ')}), reporting its
           accuracy on areas held out (default output ${DEFAULT_MODEL})
             --year ${DEFAULT_YEAR}       the year of embeddings to learn from
             --version ${DEFAULT_VERSION}    the tessera release: ${Object.keys(TESSERA_RELEASES).join(', ')}
             --per-area ${DEFAULT_PER_AREA}    pixels kept from each labelled area
  predict  map the classes over a scene's square (a path, or a URL such as a scene on
           snowline) and trace the mapped ones (woods) as scene features beside it, compared
           with the scene's own; --scene-out also writes the scene with its own swapped
             --year             default: the year the model was trained on, in its release
             --threshold ${DEFAULT_THRESHOLD}    the chance of a class that counts as it
             --min-area ${DEFAULT_MIN_AREA}    smallest area, or hole in one, kept, m²
             --bbox "w s e n"   the area to cover, when the scene has no metadata.bounds`);
}
