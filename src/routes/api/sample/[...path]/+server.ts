import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';

const SAMPLE_DIR = resolve(process.cwd(), 'sample');

/** Dev-only: serve a DEM file from ./sample. */
export async function GET({ params }) {
	if (!dev) error(404);
	const target = resolve(join(SAMPLE_DIR, normalize(params.path)));
	if (!target.startsWith(SAMPLE_DIR + '/')) error(403);
	let size: number;
	try {
		size = (await stat(target)).size;
	} catch {
		error(404);
	}
	const type = target.endsWith('.zip') ? 'application/zip' : 'application/xml';
	return new Response(Readable.toWeb(createReadStream(target)) as ReadableStream, {
		headers: { 'content-type': type, 'content-length': String(size) }
	});
}
