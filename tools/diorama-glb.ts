/**
 * A diorama GLB for a GeoJSON file, with no browser. Run `pnpm diorama-glb help`.
 *
 * Fits a circle around the features (the runs, lifts and resort area, where the file has them, as the
 * /diorama-snow page does), fetches terrain tiles for it and builds and exports the model with
 * the same code as the /diorama page, so the file is what the page's "export glb" would give
 * for that circle and settings.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FeatureCollection } from 'geojson';
import { PNG } from 'pngjs';
import { findProvider, PROVIDERS, setImageDecoder } from '../src/lib/contour/terrain-api.ts';
import { fitCircle, fitPoints } from '../src/lib/diorama/fit.ts';
import { circleSampler, MAX_RINGS } from '../src/lib/diorama/sampler.ts';
import { buildDiorama } from '../packages/diorama/src/build.ts';
import { dioramaFileName, exportDioramaData } from '../packages/diorama/src/format.ts';
import { shapesOf } from '../packages/diorama/src/geojson.ts';

const OUT_DIR = join('data', 'diorama');

/** The /diorama page's defaults. */
const DEFAULTS = {
	provider: PROVIDERS[0].id,
	rings: 224,
	exaggeration: 1,
	base: 0.25,
	contours: 50,
	major: 5
};

// Tiles come as PNG; the browser decodes them with a canvas, here pngjs does.
setImageDecoder(async (image) => {
	const bytes = Buffer.from(await image.arrayBuffer());
	if (bytes.toString('latin1', 1, 4) !== 'PNG')
		throw new Error('only png tiles can be decoded outside a browser');
	const { width, height, data } = PNG.sync.read(bytes);
	return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
});

type Options = typeof DEFAULTS & { out?: string };

function parse(args: string[]): { source?: string; options: Options } {
	const options: Options = { ...DEFAULTS };
	let source: string | undefined;
	for (const arg of args) {
		const m = /^--([a-z]+)=(.+)$/.exec(arg);
		if (!m) {
			source = arg;
			continue;
		}
		const [, key, value] = m;
		if (key === 'out') options.out = value;
		else if (key === 'provider') options.provider = value;
		else if (key in DEFAULTS) {
			const n = Number(value);
			if (!Number.isFinite(n)) throw new Error(`--${key} wants a number, got ${value}`);
			(options as Record<string, number | string>)[key] = n;
		} else throw new Error(`unknown option --${key}`);
	}
	return { source, options };
}

async function build(source: string, options: Options) {
	const collection = JSON.parse(await readFile(source, 'utf8')) as FeatureCollection;
	// The runs, lifts and resort area when the file has any; otherwise every feature.
	const fitted = fitPoints(collection);
	const points = fitted.length ? fitted : shapesOf(collection).flatMap((s) => s.coords.flat());
	if (!points.length) throw new Error(`no geometry in ${source}`);
	const circle = fitCircle(points);
	console.log(
		`${fitted.length ? 'runs, lifts and resort area' : 'features'}: ${circle.lat.toFixed(4)}, ${circle.lon.toFixed(4)}, radius ${Math.round(circle.radius)} m`
	);

	const provider = findProvider(options.provider);
	const rings = Math.min(MAX_RINGS, Math.round(options.rings));
	console.log(`${provider.label}: fetching tiles…`);
	const { sample, resolution, zoom, tiles } = await circleSampler(provider, circle, rings);
	console.log(`  ${tiles} tiles at z${zoom}, ~${resolution.toFixed(1)} m per sample`);

	const data = buildDiorama(sample, circle, { rings });
	const blob = await exportDioramaData(data, {
		exaggeration: options.exaggeration,
		baseDepth: options.base,
		contourInterval: options.contours,
		majorEvery: options.major
	});
	const target = options.out ?? join(OUT_DIR, dioramaFileName(circle));
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, Buffer.from(await blob.arrayBuffer()));

	const triangles = (data.geometry.index?.count ?? 0) / 3;
	const nodata =
		data.nodataFraction > 0.001 ? ` · ${(data.nodataFraction * 100).toFixed(1)}% no data` : '';
	console.log(
		`  ${rings} rings, ${Math.round(triangles).toLocaleString('en')} triangles · ${Math.round(data.minZ)} – ${Math.round(data.maxZ)} m${nodata}`
	);
	console.log(`  ${target}  ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
	console.log(`  ${provider.attribution}`);
}

const [command = 'help', ...rest] = process.argv.slice(2);
const { source, options } = parse(rest);

if (command === 'build' && source) {
	await build(source, options);
} else {
	console.log(`usage: pnpm diorama-glb build features.geojson [options]

  build   fit a circle around the features (the runs, lifts and resort area when there are any), fetch
          terrain tiles and export the diorama as ${join(OUT_DIR, 'diorama_<lat>_<lon>_<radius>m.glb')}

options, with the /diorama page's defaults:
  --provider=${DEFAULTS.provider.padEnd(6)}  ${PROVIDERS.map((p) => p.id).join(', ')} (png tiles only)
  --rings=${String(DEFAULTS.rings).padEnd(9)}  mesh detail, up to ${MAX_RINGS}
  --exaggeration=${DEFAULTS.exaggeration}   vertical exaggeration
  --base=${String(DEFAULTS.base).padEnd(10)}  base thickness as a fraction of the radius
  --contours=${String(DEFAULTS.contours).padEnd(6)}  contour interval in metres, 0 for none
  --major=${String(DEFAULTS.major).padEnd(9)}  every nth contour is heavier, 0 for none
  --out=path        write the file here instead`);
}
