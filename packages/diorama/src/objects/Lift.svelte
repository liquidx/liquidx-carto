<!--
	Placeholder ski lifts: for each line in `data`, towers standing on the terrain, a cable
	between their tops, a station at each end and carriers hanging along the cable.
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
		/** Lift lines: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		filter?: (feature: Feature) => boolean;
		/** Distance between towers in metres. */
		towerEvery?: number;
		/** Height of the cable above the ground at each tower, in metres. */
		height?: number;
		/** Colour of the towers, cable and stations. */
		color?: PerFeature<THREE.ColorRepresentation>;
		/** Distance between carriers (chairs or cabins) in metres, 0 for none. */
		carrierEvery?: PerFeature<number>;
		/** Size of a carrier in metres. */
		carrierSize?: PerFeature<number>;
		carrierColor?: PerFeature<THREE.ColorRepresentation>;
	};

	let {
		data,
		filter,
		towerEvery = 150,
		height = 12,
		color = '#30343b',
		carrierEvery = 90,
		carrierSize = 2.2,
		carrierColor = '#e03131'
	}: Props = $props();

	const diorama = getDiorama();
	const lines = featureShapes(
		() => data,
		() => filter
	);

	/** Points at even spacing along a path (ends included), about `every` apart. */
	function along(path: THREE.Vector3[], every: number) {
		const lengths = [0];
		for (let i = 1; i < path.length; i++)
			lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
		const total = lengths[lengths.length - 1];
		const count = Math.max(1, Math.round(total / every));
		const out: THREE.Vector3[] = [];
		let k = 1;
		for (let i = 0; i <= count; i++) {
			const d = (total * i) / count;
			while (k < path.length - 1 && lengths[k] < d) k++;
			const span = lengths[k] - lengths[k - 1] || 1;
			out.push(path[k - 1].clone().lerp(path[k], (d - lengths[k - 1]) / span));
		}
		return out;
	}

	$effect(() => {
		const routes = lines.current.filter((s) => s.kind === 'line' && s.coords[0].length > 1);
		if (!routes.length) return;

		// Unit shapes, each placed any number of times: [geometry, transforms, colours].
		const post = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
		const box = new THREE.BoxGeometry(1, 1, 1);
		const parts = {
			posts: { geometry: post, at: [] as THREE.Matrix4[], colors: [] as THREE.Color[] },
			boxes: { geometry: box, at: [] as THREE.Matrix4[], colors: [] as THREE.Color[] }
		};
		const up = new THREE.Vector3(0, 1, 0);
		/** A post of thickness `width` from `a` to `b`. */
		const rod = (a: THREE.Vector3, b: THREE.Vector3, width: number, c: THREE.Color) => {
			const span = b.clone().sub(a);
			const length = span.length();
			parts.posts.at.push(
				new THREE.Matrix4().compose(
					a.clone().add(b).multiplyScalar(0.5),
					new THREE.Quaternion().setFromUnitVectors(up, span.divideScalar(length || 1)),
					new THREE.Vector3(width, length, width)
				)
			);
			parts.posts.colors.push(c);
		};
		const block = (
			centre: THREE.Vector3,
			size: THREE.Vector3,
			turn: THREE.Quaternion,
			c: THREE.Color
		) => {
			parts.boxes.at.push(new THREE.Matrix4().compose(centre, turn, size));
			parts.boxes.colors.push(c);
		};

		const cableHeight = diorama.size(height);
		for (const { coords, feature } of routes) {
			const structure = new THREE.Color(perFeature(color, feature));
			// Towers are spaced by distance over the ground, then stood on the terrain.
			const path = coords[0].map((p) => {
				const [x, z] = diorama.toModel(p);
				return new THREE.Vector3(x, 0, z);
			});
			const feet = along(path, diorama.metres(towerEvery)).map((p) =>
				p.setY(diorama.heightAt(p.x, p.z))
			);
			const tops = feet.map((p) => p.clone().setY(p.y + cableHeight));
			// Which way the line runs on the map, to turn the stations and tower arms.
			const heading = new THREE.Quaternion().setFromAxisAngle(
				up,
				Math.atan2(tops[tops.length - 1].x - tops[0].x, tops[tops.length - 1].z - tops[0].z)
			);

			feet.forEach((foot, i) => {
				const end = i === 0 || i === feet.length - 1;
				if (end) {
					const size = new THREE.Vector3(diorama.size(9), cableHeight * 1.15, diorama.size(14));
					block(
						foot.clone().setY(foot.y + size.y / 2 - cableHeight * 0.1),
						size,
						heading,
						structure
					);
				} else {
					rod(foot.clone().setY(foot.y - cableHeight * 0.1), tops[i], diorama.size(0.9), structure);
					const arm = new THREE.Vector3(diorama.size(5), diorama.size(0.6), diorama.size(0.6));
					block(tops[i], arm, heading, structure);
				}
				if (i) rod(tops[i - 1], tops[i], diorama.size(0.35), structure);
			});

			const spacing = perFeature(carrierEvery, feature);
			if (spacing > 0) {
				const size = diorama.size(perFeature(carrierSize, feature));
				const c = new THREE.Color(perFeature(carrierColor, feature));
				for (const hang of along(tops, diorama.metres(spacing)).slice(1, -1)) {
					rod(hang.clone().setY(hang.y - size * 1.1), hang, diorama.size(0.2), c);
					block(hang.setY(hang.y - size * 1.4), new THREE.Vector3(size, size, size), heading, c);
				}
			}
		}

		const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
		const meshes = Object.values(parts).map(({ geometry, at, colors }) => {
			const mesh = new THREE.InstancedMesh(geometry, material, at.length);
			at.forEach((m, i) => mesh.setMatrixAt(i, m));
			colors.forEach((c, i) => mesh.setColorAt(i, c));
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			return mesh;
		});
		diorama.group.add(...meshes);
		return () => {
			diorama.group.remove(...meshes);
			for (const mesh of meshes) mesh.dispose();
			post.dispose();
			box.dispose();
			material.dispose();
		};
	});
</script>
