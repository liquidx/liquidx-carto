<!--
	Your own 3D model, stood on the terrain at each point in `data`, or at `at`. `src` is a
	glTF or GLB file, or a three.js object to copy. The model is scaled so its longest side is
	`size` metres, centred on the point and set down on its lowest part.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import * as THREE from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import { getDiorama } from '../context.js';
	import {
		featureShapes,
		perFeature,
		type GeoJSONSource,
		type PerFeature
	} from '../geojson.svelte.js';
	import type { LonLat } from '../surface.js';

	type Props = {
		/** URL, Blob/File or ArrayBuffer of a glTF or GLB, or an object to place copies of. */
		src: string | Blob | ArrayBuffer | THREE.Object3D | null | undefined;
		/** Points to place the model at: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		/** One position, instead of `data`. */
		at?: LonLat;
		filter?: (feature: Feature) => boolean;
		/** Length of the model's longest side in metres. */
		size?: PerFeature<number>;
		/** Which way the model's -z (its front, in glTF) faces, in degrees clockwise from north. */
		heading?: PerFeature<number>;
		/** Height of the model's base above the ground in metres. */
		altitude?: PerFeature<number>;
		onerror?: (error: unknown) => void;
	};

	let { src, data, at, filter, size = 20, heading = 0, altitude = 0, onerror }: Props = $props();

	const diorama = getDiorama();
	const points = featureShapes(
		() => data ?? (at ? { type: 'Point', coordinates: [...at] } : null),
		() => filter
	);

	// The model to copy, with what was loaded for it so it can be freed.
	let template = $state.raw<THREE.Object3D | null>(null);
	$effect(() => {
		if (!src) return;
		if (src instanceof THREE.Object3D) {
			template = src;
			return () => (template = null);
		}
		let cancelled = false;
		let loaded: THREE.Object3D | undefined;
		const loader = new GLTFLoader();
		const source = src;
		(typeof source === 'string'
			? loader.loadAsync(source)
			: Promise.resolve(source instanceof Blob ? source.arrayBuffer() : source).then((buffer) =>
					loader.parseAsync(buffer, '')
				)
		).then(
			(gltf) => {
				if (cancelled) return release(gltf.scene);
				loaded = template = gltf.scene;
			},
			(e) => {
				if (cancelled) return;
				if (onerror) onerror(e);
				else console.error('Model: could not load', source, e);
			}
		);
		return () => {
			cancelled = true;
			template = null;
			if (loaded) release(loaded);
		};
	});

	function release(object: THREE.Object3D) {
		object.traverse((o) => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh) return;
			mesh.geometry.dispose();
			for (const material of [mesh.material].flat()) {
				for (const value of Object.values(material)) {
					if (value instanceof THREE.Texture) value.dispose();
				}
				material.dispose();
			}
		});
	}

	$effect(() => {
		const original = template;
		const places = points.current.filter((s) => s.kind === 'point');
		if (!original || !places.length) return;

		const box = new THREE.Box3().setFromObject(original);
		const extent = box.getSize(new THREE.Vector3());
		const longest = Math.max(extent.x, extent.y, extent.z) || 1;
		const centre = box.getCenter(new THREE.Vector3());

		const copies = places.map(({ coords, feature }) => {
			// Copies share the original's geometry and materials.
			const copy = original.clone();
			copy.traverse((o) => (o.castShadow = o.receiveShadow = true));
			// Stand the copy on the origin of a holder, which is then scaled, turned and placed.
			copy.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
			const holder = new THREE.Group().add(copy);
			holder.scale.setScalar(diorama.size(perFeature(size, feature)) / longest);
			// Model x is east and z is south, so a clockwise heading is a negative turn about y.
			holder.rotation.y = -THREE.MathUtils.degToRad(perFeature(heading, feature));
			diorama.project(coords[0][0], 0, holder.position);
			holder.position.y += diorama.size(perFeature(altitude, feature));
			return holder;
		});
		diorama.group.add(...copies);
		return () => void diorama.group.remove(...copies);
	});
</script>
