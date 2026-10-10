/**
 * The locations the Snowboard Sim can be pointed at. Run `pnpm snowboard-locations [dir]`.
 *
 * Lists every location in a directory of terrain files (snowline's, `../snowline-data/terrain`
 * by default) that has a scene file, `<locationId>-scene.geojson`, with its name from its ski
 * features file, and writes them to `src/lib/snowboard/locations.json`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCENE = '-scene.geojson';
const OUT = join('src', 'lib', 'snowboard', 'locations.json');

const [dir = join('..', 'snowline-data', 'terrain')] = process.argv.slice(2);

const locations: { id: string; name: string }[] = [];
for (const file of await readdir(dir)) {
	if (!file.endsWith(SCENE)) continue;
	const id = file.slice(0, -SCENE.length);
	let name: string;
	try {
		const features = JSON.parse(await readFile(join(dir, `${id}-ski-features.geojson`), 'utf8'));
		name = features.metadata?.name ?? id;
	} catch {
		// A scene without its features cannot be ridden.
		console.warn(`skipped ${id}: no ski features file`);
		continue;
	}
	locations.push({ id, name });
}
locations.sort((a, b) => a.name.localeCompare(b.name, 'en'));
await writeFile(OUT, JSON.stringify(locations, null, '\t') + '\n');
console.log(`${locations.length} locations → ${OUT}`);
