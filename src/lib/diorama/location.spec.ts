import { describe, expect, it } from 'vitest';
import { fetchLocation, isLocationId, locationUrls } from './location';

const collection = (n: number) => ({
	type: 'FeatureCollection',
	features: Array.from({ length: n }, () => ({
		type: 'Feature',
		properties: {},
		geometry: { type: 'Point', coordinates: [0, 0] }
	}))
});

/** A fetch serving the given bodies by URL suffix; anything else is a 404. */
function serve(files: Record<string, unknown>): typeof fetch {
	return async (input) => {
		const url = String(input);
		const key = Object.keys(files).find((k) => url.endsWith(k));
		if (!key) return new Response(null, { status: 404 });
		const body = files[key];
		return body instanceof ArrayBuffer
			? new Response(body, { status: 200 })
			: new Response(JSON.stringify(body), { status: 200 });
	};
}

describe('location data', () => {
	it('names the three files by id', () => {
		expect(locationUrls('appi-kogen')).toEqual({
			features: 'https://content.snowline.jp/terrain/appi-kogen-ski-features.geojson',
			woods: 'https://content.snowline.jp/terrain/appi-kogen-woods.geojson',
			glb: 'https://content.snowline.jp/terrain/appi-kogen.glb'
		});
	});

	it('only accepts ids that are a single path segment', () => {
		expect(isLocationId('appi-kogen')).toBe(true);
		expect(isLocationId('Niseko_2026')).toBe(true);
		expect(isLocationId('../other')).toBe(false);
		expect(isLocationId('a/b')).toBe(false);
		expect(isLocationId('')).toBe(false);
	});

	it('fetches all three files', async () => {
		const glb = new Uint8Array([1, 2, 3]).buffer;
		const data = await fetchLocation('x', {
			fetch: serve({
				'x-ski-features.geojson': collection(2),
				'x-woods.geojson': collection(1),
				'x.glb': glb
			})
		});
		expect(data.features.features).toHaveLength(2);
		expect(data.woods.features).toHaveLength(1);
		expect(data.glb?.byteLength).toBe(3);
		expect(data.missing).toEqual([]);
	});

	it('does without the woods and the glb', async () => {
		const data = await fetchLocation('x', {
			fetch: serve({ 'x-ski-features.geojson': collection(2) })
		});
		expect(data.woods.features).toEqual([]);
		expect(data.glb).toBeNull();
		expect(data.missing).toEqual(['woods', 'glb']);
	});

	it('fails without the features', async () => {
		await expect(fetchLocation('x', { fetch: serve({}) })).rejects.toThrow(/No data/);
		await expect(fetchLocation('../x', { fetch: serve({}) })).rejects.toThrow(/Not a location id/);
	});
});
