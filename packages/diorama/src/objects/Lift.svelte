<!--
	Placeholder ski lifts: for each line in `data`, towers standing on the terrain, a cable up
	one side and back down the other, a station at each end and chairs or cabins hanging from
	the cable. With a `speed` the carriers travel round the loop.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import * as THREE from 'three';
	import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
		height?: PerFeature<number>;
		/** Colour of the towers, cable and stations. */
		color?: PerFeature<THREE.ColorRepresentation>;
		/** What hangs from the cable: open chairs or closed cabins. */
		carrier?: PerFeature<'chair' | 'cabin'>;
		/** Distance between carriers in metres, 0 for none. */
		carrierEvery?: PerFeature<number>;
		/** Width of a carrier in metres: about 0.55 a seat for a chair, 2 for a cabin. */
		carrierSize?: PerFeature<number>;
		carrierColor?: PerFeature<THREE.ColorRepresentation>;
		/** Speed of the carriers along the cable in metres a second, 0 to stand still. */
		speed?: PerFeature<number>;
	};

	let {
		data,
		filter,
		towerEvery = 80,
		height = 10,
		color = '#30343b',
		carrier = 'chair',
		carrierEvery = 15,
		carrierSize = 2.2,
		carrierColor = '#e03131',
		speed = 0
	}: Props = $props();

	/** Metres between the cable going up and the cable coming down. */
	const GAUGE = 5;

	const diorama = getDiorama();
	const lines = featureShapes(
		() => data,
		() => filter
	);

	// How far along its cable each lift's carriers have moved, in model units. Kept outside
	// the effect so that they stay where they are when the lifts are rebuilt or stopped.
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

		// Carriers one metre wide, in metres, hanging from the cable at the origin and facing +z.
		const slab = (w: number, h: number, d: number, y: number, z = 0) =>
			new THREE.BoxGeometry(w, h, d).translate(0, y, z);
		const shapes = {
			chair: [slab(0.1, 2.4, 0.1, -1.2), slab(1, 0.6, 0.08, -2.55, -0.2), slab(1, 0.1, 0.5, -2.9)],
			cabin: [slab(0.1, 1, 0.1, -0.5), slab(1, 2.1, 2.2, -2.05)]
		};
		const carriers = {
			chair: mergeGeometries(shapes.chair),
			cabin: mergeGeometries(shapes.cabin)
		};
		for (const shape of Object.values(shapes).flat()) shape.dispose();

		const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
		// The cables are far too thin to model: hairlines, which stay visible from any distance.
		const cables: number[] = [];
		const cableColors: number[] = [];
		const unit = diorama.size(1);
		const half = (GAUGE / 2) * unit;

		/** The carriers of one lift, and the loop they go round. */
		type Fleet = {
			mesh: THREE.InstancedMesh;
			/** The line midway between the two cables, with the distance along it to each point. */
			path: THREE.Vector3[];
			lengths: number[];
			gap: number;
			/** Model units a second. */
			pace: number;
			/** Sideways from the middle to the cable going up. */
			side: THREE.Vector3;
			/** Facing up the line, and back down it. */
			turns: [THREE.Quaternion, THREE.Quaternion];
			scale: THREE.Vector3;
		};
		const fleets: (Fleet | undefined)[] = routes.map(({ coords, feature }) => {
			const structure = new THREE.Color(perFeature(color, feature));
			const cableHeight = diorama.size(perFeature(height, feature));
			// Towers are spaced by distance over the ground, then stood on the terrain.
			const path = coords[0].map((p) => {
				const [x, z] = diorama.toModel(p);
				return new THREE.Vector3(x, 0, z);
			});
			const feet = along(path, diorama.metres(towerEvery)).map((p) =>
				p.setY(diorama.heightAt(p.x, p.z))
			);
			const tops = feet.map((p) => p.clone().setY(p.y + cableHeight));
			// Which way the line runs on the map, to turn the stations, tower arms and carriers.
			const bearing = Math.atan2(
				tops[tops.length - 1].x - tops[0].x,
				tops[tops.length - 1].z - tops[0].z
			);
			const heading = new THREE.Quaternion().setFromAxisAngle(up, bearing);
			// To the right of the line, where the carriers go up.
			const side = new THREE.Vector3(-Math.cos(bearing), 0, Math.sin(bearing));

			feet.forEach((foot, i) => {
				const end = i === 0 || i === feet.length - 1;
				if (end) {
					// A shed over the end of the line, set into the slope, that the carriers turn in.
					const sunk = unit * 2.5;
					const size = new THREE.Vector3(
						unit * (GAUGE + 4),
						cableHeight + unit * 2 + sunk,
						unit * 14
					);
					block(foot.clone().setY(foot.y + size.y / 2 - sunk), size, heading, structure);
				} else {
					rod(foot.clone().setY(foot.y - unit), tops[i], unit * 0.8, structure);
					const arm = new THREE.Vector3(unit * (GAUGE + 1), unit * 0.5, unit * 0.5);
					block(tops[i], arm, heading, structure);
				}
				if (!i) return;
				for (const sign of [1, -1]) {
					const a = tops[i - 1].clone().addScaledVector(side, sign * half);
					const b = tops[i].clone().addScaledVector(side, sign * half);
					cables.push(a.x, a.y, a.z, b.x, b.y, b.z);
					cableColors.push(
						structure.r,
						structure.g,
						structure.b,
						structure.r,
						structure.g,
						structure.b
					);
				}
			});

			const spacing = perFeature(carrierEvery, feature);
			if (!(spacing > 0)) return;
			const lengths = [0];
			for (let i = 1; i < tops.length; i++)
				lengths.push(lengths[i - 1] + tops[i].distanceTo(tops[i - 1]));
			// Evenly round the whole loop: up one side and back down the other.
			const loop = lengths[lengths.length - 1] * 2;
			const count = Math.max(1, Math.round(loop / diorama.metres(spacing)));
			const mesh = new THREE.InstancedMesh(carriers[perFeature(carrier, feature)], material, count);
			const c = new THREE.Color(perFeature(carrierColor, feature));
			for (let i = 0; i < count; i++) mesh.setColorAt(i, c);
			return {
				mesh,
				path: tops,
				lengths,
				gap: loop / count,
				pace: diorama.metres(perFeature(speed, feature)),
				side,
				turns: [heading, new THREE.Quaternion().setFromAxisAngle(up, bearing + Math.PI)],
				scale: new THREE.Vector3(diorama.size(perFeature(carrierSize, feature)), unit, unit)
			};
		});

		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		/** Put every carrier where it has got to, `seconds` after the last time. */
		const place = (seconds: number) => {
			fleets.forEach((fleet, n) => {
				if (!fleet) return;
				const { mesh, path, lengths, side, turns, scale } = fleet;
				const length = lengths[lengths.length - 1];
				const moved = ((travelled[n] ?? 0) + fleet.pace * seconds) % (length * 2);
				travelled[n] = moved;
				for (let i = 0; i < mesh.count; i++) {
					let d = (i * fleet.gap + moved) % (length * 2);
					const down = d > length;
					if (down) d = length * 2 - d;
					let k = 1;
					while (k < path.length - 1 && lengths[k] < d) k++;
					const span = lengths[k] - lengths[k - 1] || 1;
					position
						.lerpVectors(path[k - 1], path[k], (d - lengths[k - 1]) / span)
						.addScaledVector(side, down ? -half : half);
					mesh.setMatrixAt(i, matrix.compose(position, turns[down ? 1 : 0], scale));
				}
				mesh.instanceMatrix.needsUpdate = true;
			});
		};
		place(0);
		let stop: (() => void) | undefined;
		if (fleets.some((fleet) => fleet?.pace)) {
			let last = performance.now();
			stop = diorama.stage.onFrame(() => {
				const now = performance.now();
				// A tab left in the background picks up where it was, without a jump.
				place(Math.min(0.1, (now - last) / 1000));
				last = now;
			});
		}

		const meshes: THREE.InstancedMesh[] = Object.values(parts).map(({ geometry, at, colors }) => {
			const mesh = new THREE.InstancedMesh(geometry, material, at.length);
			at.forEach((m, i) => mesh.setMatrixAt(i, m));
			colors.forEach((c, i) => mesh.setColorAt(i, c));
			return mesh;
		});
		for (const fleet of fleets) if (fleet) meshes.push(fleet.mesh);
		for (const mesh of meshes) mesh.castShadow = mesh.receiveShadow = true;
		const wire = new THREE.BufferGeometry();
		wire.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
		wire.setAttribute('color', new THREE.Float32BufferAttribute(cableColors, 3));
		const wireMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
		const wires = new THREE.LineSegments(wire, wireMaterial);
		diorama.group.add(...meshes, wires);
		return () => {
			stop?.();
			diorama.group.remove(...meshes, wires);
			for (const mesh of meshes) mesh.dispose();
			for (const geometry of [post, box, carriers.chair, carriers.cabin, wire]) geometry.dispose();
			material.dispose();
			wireMaterial.dispose();
		};
	});
</script>
