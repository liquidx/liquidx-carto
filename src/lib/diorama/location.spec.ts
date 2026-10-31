import { describe, expect, it } from 'vitest';
import { fetchLocation, isLocationId, locationUrls, woodsOf } from './location';

const collection = (n: number) => ({
	type: 'FeatureCollection',
	features: Array.from({ length: n }, () => ({
		type: 'Feature',
		properties: { kind: 'wood' },
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
	it('names the files by id', () => {
		expect(locationUrls('appi-kogen')).toEqual({
			features: 'https://content.snowline.jp/terrain/appi-kogen-ski-features.geojson',
			scene: 'https://content.snowline.jp/terrain/appi-kogen-scene.geojson',
			woods: 'https://content.snowline.jp/terrain/appi-kogen-woods.geojson',
			glb: 'https://content.snowline.jp/terrain/appi-kogen.glb'
		});
	});

	it('reads from another base', () => {
		expect(locationUrls('appi-kogen', '/diorama/').features).toBe(
			'/diorama/appi-kogen-ski-features.geojson'
		);
	});

	it('only accepts ids that are a single path segment', () => {
		expect(isLocationId('appi-kogen')).toBe(true);
		expect(isLocationId('Niseko_2026')).toBe(true);
		expect(isLocationId('../other')).toBe(false);
		expect(isLocationId('a/b')).toBe(false);
		expect(isLocationId('')).toBe(false);
	});

	it('fetches the features, scene and glb', async () => {
		const glb = new Uint8Array([1, 2, 3]).buffer;
		const data = await fetchLocation('x', {
			fetch: serve({
				'x-ski-features.geojson': collection(2),
				'x-scene.geojson': collection(3),
				'x-woods.geojson': collection(1),
				'x.glb': glb
			})
		});
		expect(data.features.features).toHaveLength(2);
		expect(data.scene.features).toHaveLength(3);
		expect(data.glb?.byteLength).toBe(3);
		expect(data.missing).toEqual([]);
	});

	it('plants the woods file in place of the woods of the scene', async () => {
		const data = await fetchLocation('x', {
			fetch: serve({
				'x-ski-features.geojson': collection(2),
				'x-scene.geojson': collection(3),
				'x-woods.geojson': collection(1)
			})
		});
		expect(data.scene.features).toHaveLength(3);
		expect(woodsOf(data.scene, data.woods).features).toHaveLength(1);
		const without = await fetchLocation('x', {
			fetch: serve({ 'x-ski-features.geojson': collection(2), 'x-scene.geojson': collection(3) })
		});
		expect(without.woods).toBeNull();
		expect(woodsOf(without.scene, without.woods).features).toHaveLength(3);
	});

	it('plants the woods file of a location without a scene', async () => {
		const data = await fetchLocation('x', {
			fetch: serve({ 'x-ski-features.geojson': collection(2), 'x-woods.geojson': collection(1) })
		});
		expect(data.scene.features).toEqual([]);
		expect(woodsOf(data.scene, data.woods).features).toHaveLength(1);
		expect(data.missing).toEqual(['scene', 'glb']);
	});

	it('does without the scene and the glb', async () => {
		const data = await fetchLocation('x', {
			fetch: serve({ 'x-ski-features.geojson': collection(2) })
		});
		expect(data.scene.features).toEqual([]);
		expect(data.glb).toBeNull();
		expect(data.missing).toEqual(['scene', 'glb']);
	});

	it('fails without the features', async () => {
		await expect(fetchLocation('x', { fetch: serve({}) })).rejects.toThrow(/No data/);
		await expect(fetchLocation('../x', { fetch: serve({}) })).rejects.toThrow(/Not a location id/);
	});
});
