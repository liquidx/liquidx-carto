<!--
	Placeholder tree cover: low-poly conifers scattered over the polygons in `data`, standing on
	the terrain. The scatter is the same every time for a given `seed`. Give `avoid` the lines
	or areas to keep clear, such as ski runs.

	From afar, where a tree would be a speck, each clump of trees is one low mound with a few
	tree tops standing out of it, as tall as they are, and the clumps are larger the further away they are, until the woods are a cover
	over the ground: see `minSize`.
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
		/**
		 * The least height of a tree on screen, in pixels, where the view looks, for the trees to
		 * be drawn one by one. When the view is too far for that, they are all drawn in clumps: a
		 * low mound with a few tree tops standing out of it for every four, then every sixteen,
		 * then every sixty-four, which close up into a cover over the woods. 0 always draws every
		 * tree.
		 */
		minSize?: number;
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
		limit = 20_000,
		minSize = 6
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

	/** About the side of the squares the trees are grouped into for drawing, in model units. */
	const CHUNK = 0.25;
	/**
	 * The clumps the woods are drawn as when the trees are half of `minSize` or more, a quarter
	 * or more, and smaller still. A clump is as many cells of the scatter across as the first number
	 * wherever the trees fill them, and down to the second along the edges of the woods. The
	 * third is how much of the width of its cells it covers.
	 */
	const CLUMPS = [
		[2, 1, 0.92],
		[4, 1, 0.92],
		[8, 2, 0.92]
	];
	/** How much wider a clump among others is than its share of the ground. */
	const OVERLAP = 1.5;
	/** How many sides a clump has. */
	const SIDES = 7;
	/** How high a clump is in the middle, under the tree tops, as a fraction of their height. */
	const UNDER = 0.5;
	/** How far past a level's range the view goes before the level changes, in levels. */
	const STICK = 0.15;

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
	/** Side of a cell of the scatter, which has one tree at most, in model units. */
	const cell = $derived(diorama.metres(1000 / Math.sqrt(density)));

	/**
	 * Where a tree may stand: x, the ground's height, z, two random numbers, the slack: how far
	 * past its clearance the nearest of `avoid` is, and its cell of the scatter.
	 */
	type Spot = [
		x: number,
		y: number,
		z: number,
		a: number,
		b: number,
		slack: number,
		ix: number,
		iz: number
	];
	/** The cells of the scatter that a tree may stand in, with the slack of each. */
	type Cover = { ix: Int32Array; iz: Int32Array; slack: Float32Array };

	// Every spot in the polygons that clears `avoid` by its clearance, whatever the size of the
	// trees. When there are more than `limit`, that many are kept from all over the polygons.
	// `cover` is all of them all the same, for the clumps.
	const scatter = $derived.by((): { spots: Spot[]; cover: Cover | null } => {
		const polygons = areas.current
			.filter((s) => s.kind === 'polygon')
			.map((s) => s.coords.map((ring) => ring.map(diorama.toModel)));
		if (!polygons.length || density <= 0) return { spots: [], cover: null };

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
		return {
			spots: kept.map(([x, z, ix, iz, slack]) => [
				x,
				diorama.heightAt(x, z),
				z,
				hash(ix, iz, 3),
				hash(ix, iz, 4),
				slack,
				ix,
				iz
			]),
			cover: {
				ix: Int32Array.from(found, (f) => f[2]),
				iz: Int32Array.from(found, (f) => f[3]),
				slack: Float32Array.from(found, (f) => f[4])
			}
		};
	});

	$effect(() => {
		const treeHeight = diorama.size(height);
		const { stage } = diorama;
		const { spots, cover } = scatter;
		if (!cover) return;

		// The cells with room for a tree as it is now, on a grid over the whole diorama, and how
		// many there are above and to the left of each, to count those in any block at once.
		const half = Math.ceil(1 / cell / 8) * 8;
		const across = half * 2;
		const sums = new Uint32Array((across + 1) * (across + 1));
		for (let n = 0; n < cover.ix.length; n++) {
			const i = cover.ix[n] + half;
			const j = cover.iz[n] + half;
			if (cover.slack[n] < margin || i < 0 || j < 0 || i >= across || j >= across) continue;
			sums[(j + 1) * (across + 1) + i + 1] = 1;
		}
		for (let j = 1; j <= across; j++) {
			let row = 0;
			for (let i = 1; i <= across; i++) {
				row += sums[j * (across + 1) + i];
				sums[j * (across + 1) + i] = row + sums[(j - 1) * (across + 1) + i];
			}
		}
		const edge = (v: number) => Math.min(across, Math.max(0, v));
		/** How many trees a block `w` cells by `d` has room for, from cell (i, j). */
		const room = (i: number, j: number, w: number, d: number) => {
			const i0 = edge(i),
				i1 = edge(i + w),
				j0 = edge(j),
				j1 = edge(j + d);
			return (
				sums[j1 * (across + 1) + i1] -
				sums[j0 * (across + 1) + i1] -
				sums[j1 * (across + 1) + i0] +
				sums[j0 * (across + 1) + i0]
			);
		};
		if (!room(0, 0, across, across)) return;
		// A cone standing on its base, one unit tall. The base is in the ground, so it has none.
		const geometry = new THREE.ConeGeometry(0.5, 1, 6, 1, true).translate(0, 0.5, 0);
		const material = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
		const clumpMaterial = new THREE.MeshStandardMaterial({
			roughness: 0.95,
			flatShading: true,
			vertexColors: true
		});
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const turn = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		const up = new THREE.Vector3(0, 1, 0);
		const base = new THREE.Color(color);
		const tint = new THREE.Color();

		/** A square's trees, one by one. */
		const stand = (members: Spot[]) => {
			if (!members.length) return null;
			const trees = new THREE.InstancedMesh(geometry, material, members.length);
			members.forEach(([x, y, z, a, b], i) => {
				const h = treeHeight * (1 + (a * 2 - 1) * variation);
				// Sit slightly into the ground so no gap shows on a slope.
				position.set(x, y - h * 0.04, z);
				turn.setFromAxisAngle(up, b * Math.PI * 2);
				scale.set(h * 0.34, h, h * 0.34);
				trees.setMatrixAt(i, matrix.compose(position, turn, scale));
				trees.setColorAt(i, tint.copy(base).offsetHSL(0, 0, (b - 0.5) * 0.08));
			});
			return trees;
		};

		/**
		 * The clumps of the `side` cells square from cell (i0, j0): a mound over every block `most`
		 * cells across that is full of trees, and over smaller ones down to `least` where it is
		 * not, each covering `spread` of the width of its block.
		 */
		const clumps = (i0: number, j0: number, side: number, [most, least, spread]: number[]) => {
			const points: number[] = [];
			const colours: number[] = [];
			const mound = (i: number, j: number, k: number) => {
				const a = hash(i, j, 7 + k);
				const b = hash(i, j, 8 + k);
				tint.copy(base).offsetHSL(0, 0, (b - 0.5) * 0.08);
				const h = treeHeight * (1 + (a * 2 - 1) * variation);
				// Whether it is in the middle of the woods, with trees all round its block.
				const within = room(i - k / 2, j - k / 2, k * 2, k * 2) === k * k * 4;
				// As much ground as `spread` of the block each way, in a ring. In the woods it is
				// `OVERLAP` times as wide, to run into the clumps round it; beside open ground it
				// stays about within its block, to leave that clear.
				const fair = (k * cell * spread) / Math.sqrt(Math.PI);
				const reach = within
					? fair * OVERLAP
					: Math.max(fair, Math.min(fair * OVERLAP, (k / 2 + 0.5) * cell));
				// Off the middle of the block, so that the clumps do not show the grid they are on:
				// a long way in the woods, and no further than the block's edge beside open ground.
				const wander = within ? k * 0.3 : (k * (1 - spread)) / 2 + 0.25;
				const x = (i - half + k / 2 + (a * 2 - 1) * wander) * cell;
				const z = (j - half + k / 2 + (b * 2 - 1) * wander) * cell;
				const face = (...corners: number[][]) => {
					for (const corner of corners) {
						points.push(...corner);
						colours.push(tint.r, tint.g, tint.b);
					}
				};
				/** A point `out` from (cx, cz) at a turn of `at`, `y` above the ground there. */
				const around = (cx: number, cz: number, at: number, out: number, y: number) => {
					const px = cx - Math.sin(at * Math.PI * 2) * out;
					const pz = cz - Math.cos(at * Math.PI * 2) * out;
					return [px, diorama.heightAt(px, pz) + y, pz];
				};
				// The tops of the trees standing out of it: more of them the more trees it is. The
				// smallest clump is the one tree, so it comes to a point itself.
				const tips = k > 1 ? 1 + 2 * Math.log2(k) : 0;
				// The ground it covers, low in the middle: anticlockwise from above, a little into
				// the ground and uneven.
				const middle = around(x, z, 0, 0, h * (tips ? UNDER : 1));
				const rim = Array.from({ length: SIDES }, (_, n) =>
					around(x, z, a + n / SIDES, reach * (0.85 + hash(i + n, j, 9 + k) * 0.35), -h * 0.04)
				);
				rim.forEach((corner, n) => face(corner, rim[(n + 1) % SIDES], middle));
				for (let n = 0; n < tips; n++) {
					const c = hash(i + n, j - n, 11 + k);
					const d = hash(i - n, j + n, 12 + k);
					// How far out it stands, as a fraction of the way to the rim.
					const out = 0.15 + c * 0.5;
					const [tx, , tz] = around(x, z, b + (n + d * 0.6) / tips, reach * out, 0);
					const tip = around(tx, tz, 0, 0, h * (0.8 + d * 0.35));
					// Its foot is inside the cover, which is lower further out.
					const foot = h * (UNDER * (1 - out) - 0.2);
					const width = Math.max(reach * (0.2 + c * 0.12), cell * 0.25);
					const base = [0, 1, 2].map((m) => around(tx, tz, c + m / 3, width, foot));
					tint.offsetHSL(0, 0, (d - 0.5) * 0.04);
					base.forEach((corner, m) => face(corner, base[(m + 1) % 3], tip));
					tint.offsetHSL(0, 0, (0.5 - d) * 0.04);
				}
			};
			const fill = (i: number, j: number, k: number) => {
				const trees = room(i, j, k, k);
				if (!trees) return;
				if (trees === k * k || (k === least && trees * 2 >= k * k)) return mound(i, j, k);
				if (k === least) return;
				for (const [di, dj] of [
					[0, 0],
					[k / 2, 0],
					[0, k / 2],
					[k / 2, k / 2]
				])
					fill(i + di, j + dj, k / 2);
			};
			for (let j = j0; j < j0 + side; j += most)
				for (let i = i0; i < i0 + side; i += most) fill(i, j, most);
			if (!points.length) return null;
			const shape = new THREE.BufferGeometry();
			shape.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
			shape.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
			return new THREE.Mesh(shape, clumpMaterial);
		};

		// The ground in squares, each drawn only while it is in view. All of them are drawn alike,
		// as trees or as the clumps that suit how far away the view is, and each is made when it
		// first comes into view that way.
		const side = Math.max(1, Math.round(CHUNK / cell / 8)) * 8;
		type Square = {
			i: number;
			j: number;
			spots: Spot[];
			bounds: THREE.Sphere;
			/** Trees first, then each of `CLUMPS`; null where there is nothing to draw. */
			levels: (THREE.Mesh | null | undefined)[];
			level: number;
		};
		const squares: Square[] = [];
		const columns = Math.ceil(across / side);
		const byPlace: (Square | undefined)[] = [];
		for (let j = 0; j < across; j += side) {
			for (let i = 0; i < across; i += side) {
				if (!room(i, j, side, side)) continue;
				const corners = [
					[i, j],
					[i + side, j],
					[i, j + side],
					[i + side, j + side]
				].map(([ci, cj]) => {
					const [x, z] = [(edge(ci) - half) * cell, (edge(cj) - half) * cell];
					return new THREE.Vector3(x, diorama.heightAt(x, z), z);
				});
				const square: Square = {
					i,
					j,
					spots: [],
					// With room for the ground rising or falling between its corners.
					bounds: new THREE.Sphere().setFromPoints(corners),
					levels: [],
					level: -1
				};
				square.bounds.radius *= 1.25;
				squares.push(square);
				byPlace[(j / side) * columns + i / side] = square;
			}
		}
		for (const spot of spots) {
			if (spot[5] < margin) continue;
			const i = Math.floor((spot[6] + half) / side);
			const j = Math.floor((spot[7] + half) / side);
			byPlace[j * columns + i]?.spots.push(spot);
		}
		const made: THREE.Mesh[] = [];
		const make = (square: Square, level: number) => {
			const mesh = level
				? clumps(square.i, square.j, side, CLUMPS[level - 1])
				: stand(square.spots);
			if (!mesh) return null;
			mesh.castShadow = mesh.receiveShadow = true;
			mesh.visible = false;
			made.push(mesh);
			diorama.group.add(mesh);
			return mesh;
		};

		let level = -1;
		const frustum = new THREE.Frustum();
		const view = new THREE.Matrix4();
		const stopFrames = stage.onFrame(() => {
			const { camera, controls, renderer } = stage;
			const perUnit =
				renderer.domElement.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
			// One level for the whole scene, by how large a tree is where the view looks. As a
			// fraction, level n suits anything from n - 1 up to n: how many times too small it is.
			const distance = Math.max(camera.near, camera.position.distanceTo(controls.target));
			const wanted =
				minSize > 0 ? Math.log2((minSize * distance) / (treeHeight * perUnit)) : -Infinity;
			let next = Math.max(0, level);
			if (wanted > next + STICK) next = Math.ceil(wanted - STICK);
			else if (wanted < next - 1 - STICK) next = Math.ceil(wanted + STICK);
			level = Math.min(CLUMPS.length, Math.max(0, next));

			camera.updateMatrixWorld();
			frustum.setFromProjectionMatrix(
				view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
			);
			const started = performance.now();
			let changed = false;
			for (const square of squares) {
				if (square.level === level) continue;
				if (square.levels[level] === undefined) {
					// Out of view it keeps what it has, and no more are made in one frame than there
					// is time for: the rest follow in the next.
					if (!frustum.intersectsSphere(square.bounds)) continue;
					if (changed && performance.now() - started > 8) continue;
					square.levels[level] = make(square, level);
				}
				square.level = level;
				square.levels.forEach((mesh, n) => mesh && (mesh.visible = n === level));
				changed = true;
			}
			if (changed) stage.invalidateShadows();
		});
		return () => {
			stopFrames();
			diorama.group.remove(...made);
			for (const mesh of made) {
				if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
				else mesh.geometry.dispose();
			}
			geometry.dispose();
			material.dispose();
			clumpMaterial.dispose();
		};
	});
</script>
