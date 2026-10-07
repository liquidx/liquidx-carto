import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	applyVertical,
	buildDiorama,
	createTerrainMaterial,
	exportDioramaGlb,
	loadDioramaGlb,
	type DioramaMeta
} from '@liquidx/diorama';
import { legacyGridGeometry } from './legacy-grid';

describe('diorama glb', () => {
	it('round-trips the shader attributes and settings', async () => {
		const circle = { lon: 138.7, lat: 35.3, radius: 1000 };
		const data = buildDiorama((lon) => (lon - circle.lon) * 10_000 + 500, circle, { rings: 4 });
		applyVertical(data, { exaggeration: 1.5, baseDepth: 0.25 });
		const mesh = new THREE.Mesh(data.geometry, createTerrainMaterial().material);
		const meta = {
			version: 2 as const,
			minZ: data.minZ,
			maxZ: data.maxZ,
			radius: data.radius,
			lon: circle.lon,
			lat: circle.lat,
			rings: data.rings,
			exaggeration: 1.5,
			baseDepth: 0.25,
			contourInterval: 50,
			majorEvery: 4
		};

		const blob = await exportDioramaGlb(mesh, meta);
		const loaded = await loadDioramaGlb(blob);

		expect(loaded.meta).toEqual(meta);
		expect(loaded.terrain?.uniforms.uInterval.value).toBe(50);
		expect(loaded.terrain?.uniforms.uMajorEvery.value).toBe(4);
		expect(loaded.terrain?.uniforms.uExaggeration.value).toBe(1.5);
		for (const name of ['elevation', 'contourMask', 'surfaceY']) {
			const a = loaded.mesh.geometry.getAttribute(name);
			const b = data.geometry.getAttribute(name);
			expect(a.count).toBe(b.count);
			expect(Array.from(a.array)).toEqual(Array.from(b.array));
		}
		// The exporter must not leave the metadata on the source mesh.
		expect(mesh.userData).toEqual({});
	});

	const v1 = {
		version: 1,
		minZ: 500,
		maxZ: 500,
		radius: 1000,
		lon: 138.7,
		lat: 35.3,
		exaggeration: 1,
		baseDepth: 0.25,
		contourInterval: 50,
		majorEvery: 4
	} as unknown as DioramaMeta;

	it('recovers the disc layout of a version 1 file', async () => {
		const data = buildDiorama(() => 500, { lon: 138.7, lat: 35.3, radius: 1000 }, { rings: 4 });
		applyVertical(data, { exaggeration: 1, baseDepth: 0.25 });
		const mesh = new THREE.Mesh(data.geometry, createTerrainMaterial().material);

		const loaded = await loadDioramaGlb(await exportDioramaGlb(mesh, v1));

		expect(loaded.meta).toMatchObject({ version: 2, rings: 4 });
		expect(loaded.meta?.segments).toBeUndefined();
		expect(loaded.surface).not.toBeNull();
	});

	it('recognises a version 1 file with the same vertex count on every ring', async () => {
		const mesh = new THREE.Mesh(
			legacyGridGeometry(4, 8, () => 0),
			createTerrainMaterial().material
		);

		const loaded = await loadDioramaGlb(await exportDioramaGlb(mesh, v1));

		expect(loaded.meta).toMatchObject({ version: 2, rings: 4, segments: 8 });
		expect(loaded.surface).not.toBeNull();
	});
});
