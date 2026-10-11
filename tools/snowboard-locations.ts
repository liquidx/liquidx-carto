/**
 * The locations the Snowboard Sim can be pointed at. Run `pnpm snowboard-locations [dir]`.
 *
 * Lists every location in a directory of terrain files (snowline's, `../snowline-data/terrain`
 * by default) that has a scene file, `<locationId>-scene.geojson`, and its ski features file,
 * and writes their ids to `static/terrain-locations.json`. Their names come from
 * `static/snowline-locations-index.json`.
 */
import { access, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCENE = '-scene.geojson';
const OUT = join('static', 'terrain-locations.json');

const [dir = join('..', 'snowline-data', 'terrain')] = process.argv.slice(2);

const ids: string[] = [];
for (const file of await readdir(dir)) {
	if (!file.endsWith(SCENE)) continue;
	const id = file.slice(0, -SCENE.length);
	try {
		await access(join(dir, `${id}-ski-features.geojson`));
	} catch {
		// A scene without its features cannot be ridden.
		console.warn(`skipped ${id}: no ski features file`);
		continue;
	}
	ids.push(id);
}
ids.sort();
await writeFile(OUT, JSON.stringify(ids, null, '\t') + '\n');
console.log(`${ids.length} locations → ${OUT}`);
