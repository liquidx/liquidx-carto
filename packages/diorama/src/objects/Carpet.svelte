<!--
	Magic carpets: for each line in `data`, a conveyor belt lying on the terrain with a low
	rail either side. With a `speed` the belt's tread moves along it, from the line's start to
	its end.
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
		/** Carpet lines: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		filter?: (feature: Feature) => boolean;
		/** Width of the belt in metres. */
		width?: PerFeature<number>;
		/** Colour of the belt. */
		color?: PerFeature<THREE.ColorRepresentation>;
		/** Colour of the rails along its sides. */
		railColor?: PerFeature<THREE.ColorRepresentation>;
		/** Speed of the belt in metres a second, 0 to stand still. */
		speed?: PerFeature<number>;
	};

	let {
		data,
		filter,
		width = 2,
		color = '#2f3338',
		railColor = '#9aa0a6',
		speed = 0
	}: Props = $props();

	/** Metres between the treads across the belt. */
	const TREAD = 0.6;
	/** Metres between the points the belt is laid over, so that it follows the ground. */
	const STEP = 2;

	const diorama = getDiorama();
	const lines = featureShapes(
		() => data,
		() => filter
	);

	// How far each belt has run, in treads. Kept outside the effect so that it carries on from
	// where it was when the carpets are rebuilt or stopped.
	const travelled: number[] = [];

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

	/** The tread: a light bar across a dark belt, repeated along it. */
	function treadTexture(belt: THREE.Color) {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 32;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = `#${belt.getHexString()}`;
		ctx.fillRect(0, 0, 4, 32);
		ctx.fillStyle = `#${belt.clone().offsetHSL(0, 0, 0.18).getHexString()}`;
		ctx.fillRect(0, 0, 4, 6);
		const texture = new THREE.CanvasTexture(canvas);
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
		texture.magFilter = THREE.NearestFilter;
		texture.colorSpace = THREE.SRGBColorSpace;
		return texture;
	}

	$effect(() => {
		const routes = lines.current.filter((s) => s.kind === 'line' && s.coords[0].length > 1);
		if (!routes.length) return;

		const unit = diorama.size(1);
		const tread = TREAD * unit;
		const rail = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
		const railMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 });
		const up = new THREE.Vector3(0, 1, 0);

		type Belt = { mesh: THREE.Mesh; texture: THREE.Texture; pace: number };
		const belts: Belt[] = [];
		const railAt: THREE.Matrix4[] = [];
		const railColors: THREE.Color[] = [];

		for (const { coords, feature } of routes) {
			const half = diorama.size(perFeature(width, feature)) / 2;
			const path = coords[0].map((p) => {
				const [x, z] = diorama.toModel(p);
				return new THREE.Vector3(x, 0, z);
			});
			const points = along(path, diorama.metres(STEP));
			if (points.length < 2) continue;

			// A ribbon over the ground: a pair of corners either side of each point, each on the
			// terrain under it, a little up so that the belt shows on a slope.
			const lift = 0.12 * unit;
			const corners: THREE.Vector3[] = [];
			const positions: number[] = [];
			const uvs: number[] = [];
			let distance = 0;
			points.forEach((p, i) => {
				const before = points[Math.max(0, i - 1)];
				const after = points[Math.min(points.length - 1, i + 1)];
				const dir = after.clone().sub(before).setY(0).normalize();
				const across = new THREE.Vector3(-dir.z, 0, dir.x);
				if (i) distance += p.distanceTo(points[i - 1]);
				for (const sign of [1, -1]) {
					const c = p.clone().addScaledVector(across, sign * half);
					c.y = diorama.heightAt(c.x, c.z) + lift;
					corners.push(c);
					positions.push(c.x, c.y, c.z);
					uvs.push(sign > 0 ? 0 : 1, distance / tread);
				}
			});
			const indices: number[] = [];
			for (let i = 1; i < points.length; i++) {
				const a = (i - 1) * 2;
				const b = i * 2;
				indices.push(a, a + 1, b, a + 1, b + 1, b);
			}
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
			geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
			geometry.setIndex(indices);
			geometry.computeVertexNormals();
			const texture = treadTexture(new THREE.Color(perFeature(color, feature)));
			const material = new THREE.MeshStandardMaterial({
				map: texture,
				roughness: 0.9,
				side: THREE.DoubleSide
			});
			const mesh = new THREE.Mesh(geometry, material);
			mesh.castShadow = mesh.receiveShadow = true;
			belts.push({ mesh, texture, pace: diorama.metres(perFeature(speed, feature)) / tread });

			// A rail along each edge, standing on the belt.
			const c = new THREE.Color(perFeature(railColor, feature));
			for (let i = 2; i < corners.length; i++) {
				const a = corners[i - 2];
				const b = corners[i];
				const span = b.clone().sub(a);
				const length = span.length();
				railAt.push(
					new THREE.Matrix4().compose(
						a.clone().add(b).multiplyScalar(0.5).setY(Math.min(a.y, b.y)),
						new THREE.Quaternion().setFromUnitVectors(up, span.divideScalar(length || 1)),
						new THREE.Vector3(0.12 * unit, length, 0.5 * unit)
					)
				);
				railColors.push(c);
			}
		}
		if (!belts.length) return;

		const rails = new THREE.InstancedMesh(rail, railMaterial, railAt.length);
		railAt.forEach((m, i) => rails.setMatrixAt(i, m));
		railColors.forEach((c, i) => rails.setColorAt(i, c));
		rails.castShadow = rails.receiveShadow = true;

		/** Move every belt's tread on by `seconds` of travel. */
		const run = (seconds: number) => {
			belts.forEach((belt, n) => {
				travelled[n] = ((travelled[n] ?? 0) + belt.pace * seconds) % 1;
				// The tread moves up the line as the texture slides back along it.
				belt.texture.offset.y = -travelled[n];
			});
			diorama.stage.invalidate();
		};
		run(0);
		let stop: (() => void) | undefined;
		if (belts.some((belt) => belt.pace)) {
			let last = performance.now();
			stop = diorama.stage.onFrame(() => {
				const now = performance.now();
				run(Math.min(0.1, (now - last) / 1000));
				last = now;
			});
		}

		const meshes = [...belts.map((b) => b.mesh), rails];
		diorama.group.add(...meshes);
		return () => {
			stop?.();
			diorama.group.remove(...meshes);
			for (const { mesh, texture } of belts) {
				mesh.geometry.dispose();
				(mesh.material as THREE.Material).dispose();
				texture.dispose();
			}
			rails.dispose();
			rail.dispose();
			railMaterial.dispose();
		};
	});
</script>
