<!--
	Placeholder tree cover: low-poly conifers scattered over the polygons in `data`, standing on
	the terrain. The scatter is the same every time for a given `seed`. Give `avoid` the lines
	or areas to keep clear, such as ski runs.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import * as THREE from 'three';
	import { getDiorama } from '../context.js';
	import {
		featureShapes,
		perFeature,
		type GeoJSONSource,
		type PerFeature
	} from '../geojson.svelte.js';

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
		/** Distance in metres to keep from `avoid`: one for everything, or by feature. */
		clearance?: PerFeature<number>;
		seed?: number;
		/** Upper bound on the number of trees. Past it the cover is thinned evenly. */
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

	/** Whether (x, z) is in the polygon whose edges are `edges`, as x0, z0, x1, z1 one after another. */
	function inside(x: number, z: number, edges: number[]) {
		let hit = false;
		for (let i = 0; i < edges.length; i += 4) {
			const xi = edges[i],
				zi = edges[i + 1],
				xj = edges[i + 2],
				zj = edges[i + 3];
			if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
		}
		return hit;
	}

	/** Side of the squares the trees are grouped into for drawing, in model units. */
	const CHUNK = 0.25;

	// Room for the tree's own width, past the clearance.
	const margin = $derived(diorama.size(height) * 0.17);
	// The clearance of each obstacle in model units, with the largest of them.
	const clearances = $derived.by(() => {
		const byShape = obstacles.current.map((s) => diorama.metres(perFeature(clearance, s.feature)));
		return { byShape, most: Math.max(0, ...byShape) };
	});
	// As far as the scatter needs to measure to `avoid`. It moves in steps, so that the trees
	// growing or shrinking with the object scale does not scatter them again.
	const reach = $derived(2 ** Math.ceil(Math.log2(clearances.most + margin)));

	/**
	 * Where a tree may stand: x, the ground's height, z, two random numbers, and the slack: how
	 * far past its clearance the nearest of `avoid` is.
	 */
	type Spot = [x: number, y: number, z: number, a: number, b: number, slack: number];

	// Every spot in the polygons that clears `avoid` by its clearance, whatever the size of the
	// trees. When there are more than `limit`, that many are kept from all over the polygons.
	const spots = $derived.by((): Spot[] => {
		const polygons = areas.current
			.filter((s) => s.kind === 'polygon')
			.map((s) => s.coords.map((ring) => ring.map(diorama.toModel)));
		if (!polygons.length || density <= 0) return [];

		// Segments to stay clear of, as [x0, z0, x1, z1, clearance] in model space.
		const segments: [number, number, number, number, number][] = [];
		obstacles.current.forEach((shape, n) => {
			if (shape.kind === 'point') return;
			const c = clearances.byShape[n];
			for (const path of shape.coords) {
				const p = path.map(diorama.toModel);
				for (let i = 1; i < p.length; i++) segments.push([...p[i - 1], ...p[i], c]);
			}
		});
		// The segments each square of a grid comes within `reach` of, so that a spot only measures
		// to the few around it.
		const side = Math.max(reach, 1 / 64);
		const across = Math.ceil(2 / side);
		const square = (v: number) => Math.min(across - 1, Math.max(0, Math.floor((v + 1) / side)));
		const near: [number, number, number, number, number][][] = [];
		for (const segment of segments) {
			const [x0, z0, x1, z1] = segment;
			for (let j = square(Math.min(z0, z1) - reach); j <= square(Math.max(z0, z1) + reach); j++) {
				for (let i = square(Math.min(x0, x1) - reach); i <= square(Math.max(x0, x1) + reach); i++) {
					(near[j * across + i] ??= []).push(segment);
				}
			}
		}
		/** The least slack to any segment, measured no further than `reach` past its clearance. */
		const slackAt = (x: number, z: number) => {
			let slack = reach;
			const around = near[square(z) * across + square(x)];
			if (!around) return slack;
			for (let i = 0; i < around.length; i++) {
				const [x0, z0, x1, z1, c] = around[i];
				const dx = x1 - x0;
				const dz = z1 - z0;
				const t = Math.min(
					1,
					Math.max(0, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1))
				);
				slack = Math.min(slack, Math.hypot(x - x0 - t * dx, z - z0 - t * dz) - c);
			}
			return slack;
		};

		// One candidate per cell of a grid shared by all polygons, jittered within its cell.
		const cell = diorama.metres(1000 / Math.sqrt(density));
		const found: [x: number, z: number, ix: number, iz: number, slack: number][] = [];
		// Local to this run, never read reactively.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();
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
			const first = Math.floor(z0 / cell);
			const last = Math.floor(z1 / cell);
			// The polygon's edges by the rows of the grid they cross, so that a spot is only tested
			// against the few beside it.
			const rows: number[][] = [];
			for (const ring of rings) {
				for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
					const [xi, zi] = ring[i];
					const [xj, zj] = ring[j];
					const from = Math.max(first, Math.floor(Math.min(zi, zj) / cell));
					const to = Math.min(last, Math.floor(Math.max(zi, zj) / cell));
					for (let row = from; row <= to; row++) (rows[row - first] ??= []).push(xi, zi, xj, zj);
				}
			}
			for (let iz = first; iz <= last; iz++) {
				const edges = rows[iz - first];
				if (!edges) continue;
				for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++) {
					const key = `${ix},${iz}`;
					if (seen.has(key)) continue;
					const x = (ix + hash(ix, iz, 1)) * cell;
					const z = (iz + hash(ix, iz, 2)) * cell;
					if (x * x + z * z > 0.97 || !inside(x, z, edges)) continue;
					const slack = slackAt(x, z);
					// Too close whatever the size of the trees.
					if (slack < 0) continue;
					seen.add(key);
					found.push([x, z, ix, iz, slack]);
				}
			}
		}
		// Too many: keep the spots a hash of their cell puts first, which thins every polygon alike
		// where stopping at the limit would leave the last ones bare.
		let kept = found;
		if (found.length > limit) {
			const order = new Float64Array(found.length);
			found.forEach(([, , ix, iz], i) => (order[i] = hash(ix, iz, 5)));
			const most = order.slice().sort()[Math.max(0, limit)];
			kept = found.filter((_, i) => order[i] < most);
		}
		return kept.map(([x, z, ix, iz, slack]) => [
			x,
			diorama.heightAt(x, z),
			z,
			hash(ix, iz, 3),
			hash(ix, iz, 4),
			slack
		]);
	});

	$effect(() => {
		const treeHeight = diorama.size(height);
		// Trees in squares of the ground, each drawn only while it is in view.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const chunks = new Map<string, Spot[]>();
		for (const spot of spots) {
			if (spot[5] < margin) continue;
			const key = `${Math.floor(spot[0] / CHUNK)},${Math.floor(spot[2] / CHUNK)}`;
			const chunk = chunks.get(key);
			if (chunk) chunk.push(spot);
			else chunks.set(key, [spot]);
		}
		if (!chunks.size) return;

		// A cone standing on its base, one unit tall. The base is in the ground, so it has none.
		const geometry = new THREE.ConeGeometry(0.5, 1, 6, 1, true).translate(0, 0.5, 0);
		const material = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const turn = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		const up = new THREE.Vector3(0, 1, 0);
		const base = new THREE.Color(color);
		const tint = new THREE.Color();
		const meshes = [...chunks.values()].map((chunk) => {
			const trees = new THREE.InstancedMesh(geometry, material, chunk.length);
			trees.castShadow = true;
			trees.receiveShadow = true;
			chunk.forEach(([x, y, z, a, b], i) => {
				const h = treeHeight * (1 + (a * 2 - 1) * variation);
				// Sit slightly into the ground so no gap shows on a slope.
				position.set(x, y - h * 0.04, z);
				turn.setFromAxisAngle(up, b * Math.PI * 2);
				scale.set(h * 0.34, h, h * 0.34);
				trees.setMatrixAt(i, matrix.compose(position, turn, scale));
				trees.setColorAt(i, tint.copy(base).offsetHSL(0, 0, (b - 0.5) * 0.08));
			});
			return trees;
		});
		diorama.group.add(...meshes);
		return () => {
			diorama.group.remove(...meshes);
			for (const trees of meshes) trees.dispose();
			geometry.dispose();
			material.dispose();
		};
	});
</script>
