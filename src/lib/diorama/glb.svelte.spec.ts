import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTerrainMaterial, exportDioramaGlb, loadDioramaGlb } from '@liquidx/diorama';
import { applyVertical, buildDiorama } from './geometry';

describe('diorama glb', () => {
	it('round-trips the shader attributes and settings', async () => {
		const circle = { lon: 138.7, lat: 35.3, radius: 1000 };
		const data = buildDiorama((lon) => (lon - circle.lon) * 10_000 + 500, circle, { rings: 4 });
		applyVertical(data, { exaggeration: 1.5, baseDepth: 0.25 });
		const mesh = new THREE.Mesh(data.geometry, createTerrainMaterial().material);
		const meta = {
			version: 1 as const,
			minZ: data.minZ,
			maxZ: data.maxZ,
			radius: data.radius,
			lon: circle.lon,
			lat: circle.lat,
			exaggeration: 1.5,
			baseDepth: 0.25,
			contourInterval: 50,
			majorEvery: 4
		};

		const blob = await exportDioramaGlb(mesh, meta);
		const loaded = await loadDioramaGlb(blob);

		expect(loaded.meta).toEqual(meta);
		expect(loaded.uniforms?.uInterval.value).toBe(50);
		expect(loaded.uniforms?.uMajorEvery.value).toBe(4);
		for (const name of ['elevation', 'contourMask', 'surfaceY']) {
			const a = loaded.mesh.geometry.getAttribute(name);
			const b = data.geometry.getAttribute(name);
			expect(a.count).toBe(b.count);
			expect(Array.from(a.array)).toEqual(Array.from(b.array));
		}
		// The exporter must not leave the metadata on the source mesh.
		expect(mesh.userData).toEqual({});
	});
});
