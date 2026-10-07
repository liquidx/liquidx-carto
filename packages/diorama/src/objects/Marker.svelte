<!--
	Placeholder marker: a pin standing on the terrain at each point in `data`, or at `at`.
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
		/** Points to mark: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		/** One position, instead of `data`. */
		at?: LonLat;
		filter?: (feature: Feature) => boolean;
		/** Height of the pin in metres. */
		height?: number;
		color?: PerFeature<THREE.ColorRepresentation>;
	};

	let { data, at, filter, height = 40, color = '#e03131' }: Props = $props();

	const diorama = getDiorama();
	const points = featureShapes(
		() => data ?? (at ? { type: 'Point', coordinates: [...at] } : null),
		() => filter
	);

	$effect(() => {
		const places = points.current.filter((s) => s.kind === 'point');
		if (!places.length) return;

		const tall = diorama.size(height);
		const pole = new THREE.CylinderGeometry(tall * 0.03, tall * 0.03, tall, 8).translate(
			0,
			tall / 2,
			0
		);
		const head = new THREE.SphereGeometry(tall * 0.22, 20, 12).translate(0, tall, 0);
		const materials: THREE.Material[] = [];
		const pins = places.map(({ coords, feature }) => {
			const material = new THREE.MeshStandardMaterial({
				color: perFeature(color, feature),
				roughness: 0.5
			});
			materials.push(material);
			const pin = new THREE.Group().add(
				new THREE.Mesh(pole, material),
				new THREE.Mesh(head, material)
			);
			pin.traverse((o) => (o.castShadow = true));
			diorama.project(coords[0][0], 0, pin.position);
			return pin;
		});
		diorama.group.add(...pins);
		return () => {
			diorama.group.remove(...pins);
			pole.dispose();
			head.dispose();
			for (const material of materials) material.dispose();
		};
	});
</script>
