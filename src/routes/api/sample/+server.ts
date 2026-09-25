import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SAMPLE_DIR = join(process.cwd(), 'sample');

async function walk(dir: string, out: string[]) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) await walk(p, out);
		else if (/DEM.*\.(xml|zip)$/i.test(entry.name)) out.push(p);
	}
}

/** Dev-only: list DEM files under ./sample so they can be loaded without drag-and-drop. */
export async function GET() {
	if (!dev) error(404);
	const files: string[] = [];
	try {
		await walk(SAMPLE_DIR, files);
	} catch {
		return json({ files: [] });
	}
	return json({
		files: files
			.map((f) => relative(SAMPLE_DIR, f))
			.sort()
			.map((path) => ({
				path,
				url: `/api/sample/${path.split('/').map(encodeURIComponent).join('/')}`
			}))
	});
}
