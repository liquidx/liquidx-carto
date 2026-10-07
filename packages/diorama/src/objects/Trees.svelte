<!--
	Placeholder tree cover: low-poly conifers scattered over the polygons in `data`, standing on
	the terrain. The scatter is the same every time for a given `seed`. Give `avoid` the lines
	or areas to keep clear, such as ski runs.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import * as THREE from 'three';
	import { getDiorama } from '../context.js';
	import { featureShapes, type GeoJSONSource } from '../geojson.svelte.js';

	type Props = {
		/** Polygons to cover: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		filter?: (feature: Feature) => boolean;
		/** Trees per square kilometre. */
		density?: number;
		/** Typical tree height in metres. */
		height?: number;
		/** How much heights vary, as a fraction of `height`. */
		variation?: number;
		color?: THREE.ColorRepresentation;
		/** Lines and polygon outlines to keep trees away from. */
		avoid?: GeoJSONSource;
		/** Distance in metres to keep from `avoid`. */
		clearance?: number;
		seed?: number;
		/** Upper bound on the number of trees. */
		limit?: number;
	};

	let {
		data,
		filter,
		density = 250,
		height = 14,
		variation = 0.35,
		color = '#56a65d',
		avoid,
		clearance = 20,
		seed = 1,
		limit = 20_000
	}: Props = $props();

	const diorama = getDiorama();
	const areas = featureShapes(
		() => data,
		() => filter
	);
	const obstacles = featureShapes(
		() => avoid,
		() => undefined
	);

	/** A repeatable number in 0–1 for a grid cell. */
	function hash(ix: number, iz: number, salt: number) {
		let h =
			Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(salt + seed, 0x9e3779b1);
		h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
		h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	}

	function inside(x: number, z: number, rings: [number, number][][]) {
		let hit = false;
		for (const ring of rings) {
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const [xi, zi] = ring[i];
				const [xj, zj] = ring[j];
				if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
			}
		}
		return hit;
	}

	$effect(() => {
		const polygons = areas.current
			.filter((s) => s.kind === 'polygon')
			.map((s) => s.coords.map((ring) => ring.map(diorama.toModel)));
		if (!polygons.length || density <= 0) return;

		// Segments to stay clear of, as [x0, z0, x1, z1] in model space.
		const segments: [number, number, number, number][] = [];
		for (const shape of obstacles.current) {
			if (shape.kind === 'point') continue;
			for (const path of shape.coords) {
				const p = path.map(diorama.toModel);
				for (let i = 1; i < p.length; i++) segments.push([...p[i - 1], ...p[i]]);
			}
		}
		const treeHeight = diorama.size(height);
		const keepOut = diorama.metres(clearance) + treeHeight * 0.17;
		const blocked = (x: number, z: number) => {
			for (const [x0, z0, x1, z1] of segments) {
				// Most segments are nowhere near: rule those out cheaply.
				if (
					x < Math.min(x0, x1) - keepOut ||
					x > Math.max(x0, x1) + keepOut ||
					z < Math.min(z0, z1) - keepOut ||
					z > Math.max(z0, z1) + keepOut
				)
					continue;
				const dx = x1 - x0;
				const dz = z1 - z0;
				const t = Math.min(
					1,
					Math.max(0, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1))
				);
				if (Math.hypot(x - x0 - t * dx, z - z0 - t * dz) < keepOut) return true;
			}
			return false;
		};

		// One candidate per cell of a grid shared by all polygons, jittered within its cell.
		const cell = diorama.metres(1000 / Math.sqrt(density));
		// Local to this run of the effect, never read reactively.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const spots = new Map<string, [number, number, number, number]>();
		for (const rings of polygons) {
			let x0 = Infinity,
				x1 = -Infinity,
				z0 = Infinity,
				z1 = -Infinity;
			for (const [x, z] of rings[0]) {
				x0 = Math.min(x0, x);
				x1 = Math.max(x1, x);
				z0 = Math.min(z0, z);
				z1 = Math.max(z1, z);
			}
			x0 = Math.max(x0, -1);
			x1 = Math.min(x1, 1);
			z0 = Math.max(z0, -1);
			z1 = Math.min(z1, 1);
			for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {
				for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) {
					const key = `${ix},${iz}`;
					if (spots.has(key)) continue;
					const x = (ix + hash(ix, iz, 1)) * cell;
					const z = (iz + hash(ix, iz, 2)) * cell;
					if (x * x + z * z > 0.97 || !inside(x, z, rings) || blocked(x, z)) continue;
					spots.set(key, [x, z, hash(ix, iz, 3), hash(ix, iz, 4)]);
					if (spots.size >= limit) break;
				}
				if (spots.size >= limit) break;
			}
		}
		if (!spots.size) return;

		// A cone standing on its base, one unit tall. The base is in the ground, so it has none.
		const geometry = new THREE.ConeGeometry(0.5, 1, 6, 1, true).translate(0, 0.5, 0);
		const material = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
		const trees = new THREE.InstancedMesh(geometry, material, spots.size);
		trees.castShadow = true;
		trees.receiveShadow = true;
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const turn = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		const up = new THREE.Vector3(0, 1, 0);
		const base = new THREE.Color(color);
		const tint = new THREE.Color();
		let i = 0;
		for (const [x, z, a, b] of spots.values()) {
			const h = treeHeight * (1 + (a * 2 - 1) * variation);
			// Sit slightly into the ground so no gap shows on a slope.
			position.set(x, diorama.heightAt(x, z) - h * 0.04, z);
			turn.setFromAxisAngle(up, b * Math.PI * 2);
			scale.set(h * 0.34, h, h * 0.34);
			trees.setMatrixAt(i, matrix.compose(position, turn, scale));
			trees.setColorAt(i, tint.copy(base).offsetHSL(0, 0, (b - 0.5) * 0.08));
			i++;
		}
		diorama.group.add(trees);
		return () => {
			diorama.group.remove(trees);
			trees.dispose();
			geometry.dispose();
			material.dispose();
		};
	});
</script>
