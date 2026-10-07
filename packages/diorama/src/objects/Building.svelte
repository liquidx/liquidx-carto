<!--
	Placeholder buildings. A polygon in `data` is extruded from its footprint with a flat roof;
	a point (or `at`) gets a box of `footprint` size with a pitched roof.
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
	import type { LonLat } from '../surface.js';

	type Props = {
		/** Footprints or points to build on: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		/** One position, instead of `data`. */
		at?: LonLat;
		filter?: (feature: Feature) => boolean;
		/** Wall height in metres. */
		height?: PerFeature<number>;
		/** Width and depth in metres of a building placed at a point. */
		footprint?: PerFeature<[width: number, depth: number]>;
		/** Which way the long side of a building at a point runs, in degrees clockwise from north. */
		heading?: PerFeature<number>;
		color?: PerFeature<THREE.ColorRepresentation>;
		roofColor?: PerFeature<THREE.ColorRepresentation>;
	};

	let {
		data,
		at,
		filter,
		height = 9,
		footprint = [30, 16],
		heading = 90,
		color = '#d9c8ad',
		roofColor = '#8a3f32'
	}: Props = $props();

	const diorama = getDiorama();
	const shapes = featureShapes(
		() => data ?? (at ? { type: 'Point', coordinates: [...at] } : null),
		() => filter
	);

	$effect(() => {
		const sites = shapes.current.filter((s) => s.kind !== 'line');
		if (!sites.length) return;

		const owned: { dispose(): void }[] = [];
		const keep = <T extends { dispose(): void }>(item: T) => (owned.push(item), item);
		const paint = (c: THREE.ColorRepresentation) =>
			keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));

		// For buildings at points: unit walls standing on the ground, and a unit roof with its
		// ridge along x.
		const walls = keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
		const gable = new THREE.Shape().moveTo(-0.5, 0).lineTo(0.5, 0).lineTo(0, 1).closePath();
		const roof = keep(
			new THREE.ExtrudeGeometry(gable, { depth: 1, bevelEnabled: false })
				.translate(0, 0, -0.5)
				.rotateY(Math.PI / 2)
		);

		const buildings = sites.map(({ kind, coords, feature }) => {
			const h = diorama.size(perFeature(height, feature));
			const wallPaint = paint(perFeature(color, feature));
			const roofPaint = paint(perFeature(roofColor, feature));

			if (kind === 'polygon') {
				const rings = coords.map((ring) => ring.map(diorama.toModel));
				const cx = rings[0].reduce((sum, p) => sum + p[0], 0) / rings[0].length;
				const cz = rings[0].reduce((sum, p) => sum + p[1], 0) / rings[0].length;
				// Like every object, the footprint grows about its middle with the object scale.
				const grow = diorama.size(1) / diorama.metres(1);
				const outline = (ring: [number, number][]) =>
					ring.map(([x, z]) => new THREE.Vector2((x - cx) * grow, (z - cz) * grow));
				const plan = new THREE.Shape(outline(rings[0]));
				plan.holes = rings.slice(1).map((ring) => new THREE.Path(outline(ring)));
				// Stand on the lowest corner and rise to `height` above the highest, for a level roof.
				const ground = rings[0].map(([x, z]) => diorama.heightAt(x, z));
				const low = Math.min(...ground) - h * 0.1;
				const high = Math.max(...ground) + h;
				// Extruding runs along the shape's z; turned to lie flat, that is down from the roof.
				const solid = keep(
					new THREE.ExtrudeGeometry(plan, { depth: high - low, bevelEnabled: false }).rotateX(
						Math.PI / 2
					)
				);
				// Extrusions come in two groups: the caps (roof and floor), then the sides.
				const building = new THREE.Mesh(solid, [roofPaint, wallPaint]);
				building.position.set(cx, high, cz);
				building.castShadow = building.receiveShadow = true;
				return building;
			}

			const [w, d] = perFeature(footprint, feature).map(diorama.size);
			const body = new THREE.Mesh(walls, wallPaint);
			body.scale.set(w, h, d);
			const top = new THREE.Mesh(roof, roofPaint);
			top.scale.set(w * 1.06, d * 0.45, d * 1.12);
			top.position.y = h;
			const building = new THREE.Group().add(body, top);
			building.traverse((o) => (o.castShadow = o.receiveShadow = true));
			diorama.project(coords[0][0], 0, building.position);
			// Sink the footing so a slope does not show under the downhill wall.
			building.position.y -= h * 0.25;
			// Model x is east and z is south, so a clockwise heading is a negative turn about y.
			building.rotation.y = THREE.MathUtils.degToRad(90 - perFeature(heading, feature));
			return building;
		});
		diorama.group.add(...buildings);
		return () => {
			diorama.group.remove(...buildings);
			for (const item of owned) item.dispose();
		};
	});
</script>
