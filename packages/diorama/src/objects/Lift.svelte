<!--
	Placeholder ski lifts: for each line in `data`, towers standing on the terrain, a cable up
	one side and back down the other, a station at each end and chairs or cabins hanging from
	the cable. With a `speed` the carriers travel round the loop. A `carrierModel` hangs your
	own glTF in place of the built-in chair or cabin, in its own colours. A lift whose carriers
	are only a few pixels tall from where the view is has a plain block drawn for each.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import { onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
		/**
		 * The least the cable is above the ground anywhere, in metres: where the ground bulges up
		 * under a span, the towers at its ends stand taller than `height` to keep this clear.
		 */
		clearance?: PerFeature<number>;
		/** Colour of the towers, cable and stations. */
		color?: PerFeature<THREE.ColorRepresentation>;
		/** Whether a station stands over each end of the line; without, a tower like the others. */
		stations?: PerFeature<boolean>;
		/**
		 * A model to stand at each end instead of the built-in station: the URL of a glTF or GLB,
		 * or an object. It is in metres with its origin on the ground where the line ends, and
		 * faces +z along the line. Of its named nodes, `Mast` is stretched (its y scale) and
		 * `Head` raised to the `height` of the cable, and `Bullwheel` turns with the carriers.
		 */
		stationModel?: PerFeature<string | THREE.Object3D | null | undefined>;
		/** What hangs from the cable: open chairs or closed cabins, or the ball of a rope tow on it. */
		carrier?: PerFeature<'chair' | 'cabin' | 'ball'>;
		/** Distance between carriers in metres, 0 for none. */
		carrierEvery?: PerFeature<number>;
		/**
		 * Width of a carrier in metres across the line. A chair gets a seat every 0.55 m of it,
		 * so 1.3 is a double and 2.4 a quad; a cabin is a little longer than it is wide; a ball is
		 * this wide.
		 */
		carrierSize?: PerFeature<number>;
		carrierColor?: PerFeature<THREE.ColorRepresentation>;
		/**
		 * A model to hang instead of the built-in carrier: the URL of a glTF or GLB, or an object.
		 * It is in metres with the cable through its origin, faces +z and keeps its own materials;
		 * `carrierSize` and `carrierColor` do not apply to it.
		 */
		carrierModel?: PerFeature<string | THREE.Object3D | null | undefined>;
		/**
		 * Named parts of the `carrierModel`: `false` to leave one out, or how far it is swung
		 * open, from 0 (closed) to 1, the `openRotationX` in its extras.
		 */
		carrierParts?: PerFeature<Record<string, number | boolean>>;
		/**
		 * An aerial tramway: just two carriers, one on each side, which keep to their own side
		 * and go up and down it in turn, passing halfway. `carrierEvery` then only says whether
		 * there are any.
		 */
		shuttle?: PerFeature<boolean>;
		/** Speed of the carriers along the cable in metres a second, 0 to stand still. */
		speed?: PerFeature<number>;
	};

	let {
		data,
		filter,
		towerEvery = 80,
		height = 10,
		clearance = 0,
		color = '#30343b',
		stations = true,
		stationModel,
		carrier = 'chair',
		carrierEvery = 15,
		carrierSize = 2.2,
		carrierColor = '#e03131',
		carrierModel,
		carrierParts = {},
		shuttle = false,
		speed = 0
	}: Props = $props();

	/** Metres between the cable going up and the cable coming down. */
	const GAUGE = 5;
	/**
	 * The height of a carrier on screen, in pixels, from which it is drawn in full, and the
	 * lower one under which it goes back to a block.
	 */
	const DETAIL = [10, 8];

	const diorama = getDiorama();
	const lines = featureShapes(
		() => data,
		() => filter
	);

	// How far along its cable each lift's carriers have moved, in model units. Kept outside
	// the effect so that they stay where they are when the lifts are rebuilt or stopped.
	const travelled: number[] = [];

	// Carrier and station models given as URLs, once they have loaded.
	let models = $state.raw<Record<string, THREE.Object3D>>({});
	const asked: Record<string, true> = {};
	let gone = false;
	$effect(() => {
		for (const { feature } of lines.current) {
			for (const source of [perFeature(carrierModel, feature), perFeature(stationModel, feature)]) {
				if (typeof source !== 'string' || asked[source]) continue;
				asked[source] = true;
				new GLTFLoader().loadAsync(source).then(
					({ scene }) => {
						if (gone) release(scene);
						else models = { ...models, [source]: scene };
					},
					(e) => console.error('Lift: could not load', source, e)
				);
			}
		}
	});
	onDestroy(() => {
		gone = true;
		Object.values(models).forEach(release);
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

		// Carriers in metres, hanging from the cable at the origin and facing +z, one shape for
		// each width asked for.
		const slab = (w: number, h: number, d: number, y: number, z = 0, x = 0) =>
			new THREE.BoxGeometry(w, h, d).translate(x, y, z);
		const carrierShapes = {
			/** A bench with a back, a safety bar and an armrest between every seat. */
			chair(width: number) {
				const seats = Math.max(1, Math.round(width / 0.55));
				const parts = [
					slab(0.1, 2.3, 0.1, -1.15, -0.2),
					slab(width, 0.08, 0.08, -2.3, -0.2),
					slab(width, 0.6, 0.08, -2.6, -0.25),
					slab(width, 0.1, 0.55, -2.9),
					slab(width, 0.05, 0.05, -2.45, 0.3)
				];
				for (let i = 0; i <= seats; i++) {
					const x = -width / 2 + (width * i) / seats;
					parts.push(slab(0.06, 0.3, 0.5, -2.7, 0, x));
				}
				return parts;
			},
			/** A cabin a little longer than it is wide, with a roof, a tapered floor and a hanger. */
			cabin(width: number) {
				const length = width * 1.15;
				const skirt = new THREE.CylinderGeometry(1, 0.62, 0.45, 4, 1)
					.rotateY(Math.PI / 4)
					.scale(width / Math.SQRT2, 1, length / Math.SQRT2)
					.translate(0, -3.125, 0);
				return [
					slab(0.12, 1, 0.12, -0.5),
					slab(0.35, 0.3, 0.5, -0.15),
					slab(width * 0.92, 0.15, length * 0.92, -1.075),
					slab(width, 1.75, length, -2.025),
					skirt
				];
			},
			/** A ball on the rope to hold on to. */
			ball(width: number) {
				return [new THREE.SphereGeometry(width / 2, 12, 8)];
			}
		};
		// Local to this run, never read reactively.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const carriers = new Map<string, THREE.BufferGeometry>();
		const carrierGeometry = (kind: keyof typeof carrierShapes, width: number) => {
			const key = `${kind}:${width.toFixed(2)}`;
			let geometry = carriers.get(key);
			if (!geometry) {
				const parts = carrierShapes[kind](width);
				geometry = mergeGeometries(parts);
				for (const part of parts) part.dispose();
				carriers.set(key, geometry);
			}
			return geometry;
		};

		// A model as one shape for each of its materials, with its `parts` posed.
		const posed: THREE.BufferGeometry[] = [];
		// The blocks that stand for the carriers from afar.
		const blocks: THREE.BufferGeometry[] = [];
		const modelShapes = (model: THREE.Object3D, parts: Record<string, number | boolean>) => {
			// The copy shares the model's geometry and materials.
			const copy = model.clone();
			for (const [name, state] of Object.entries(parts)) {
				const part = copy.getObjectByName(name);
				if (!part) continue;
				if (typeof state === 'boolean') part.visible = state;
				else part.rotation.x = (part.userData.openRotationX ?? 0) * state;
			}
			copy.updateMatrixWorld(true);
			// Local to this run, never read reactively.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
			copy.traverseVisible((o) => {
				const mesh = o as THREE.Mesh;
				if (!mesh.isMesh) return;
				const material = [mesh.material].flat()[0];
				const pieces = byMaterial.get(material) ?? [];
				pieces.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
				byMaterial.set(material, pieces);
			});
			return [...byMaterial].map(([material, pieces]) => {
				const geometry = mergeGeometries(pieces);
				for (const piece of pieces) piece.dispose();
				posed.push(geometry);
				return { geometry, material };
			});
		};

		const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
		// The cables are far too thin to model: hairlines, which stay visible from any distance.
		const cables: number[] = [];
		const cableColors: number[] = [];
		const unit = diorama.size(1);
		const half = (GAUGE / 2) * unit;
		// Station models stood at the ends of the lines, and their bullwheels with how fast each
		// turns, in radians a second.
		const placed: THREE.Object3D[] = [];
		const wheels: { wheel: THREE.Object3D; turn: number }[] = [];

		/** The carriers of one lift, and the loop they go round. */
		type Fleet = {
			/** One mesh for the built-in carrier, or one for each material of a model. */
			meshes: THREE.InstancedMesh[];
			/** A block the size of the carrier for each, drawn instead of `meshes` from afar. */
			block: THREE.InstancedMesh;
			/** Height of a carrier in model units, and a sphere around the whole line. */
			tall: number;
			bounds: THREE.Sphere;
			/** The line midway between the two cables, with the distance along it to each point. */
			path: THREE.Vector3[];
			lengths: number[];
			gap: number;
			/** Model units a second. */
			pace: number;
			shuttle: boolean;
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
			const clear = diorama.size(perFeature(clearance, feature));
			if (clear > 0) {
				const probe = new THREE.Vector3();
				for (let pass = 0; pass < 3; pass++)
					for (let i = 1; i < tops.length; i++) {
						let short = 0;
						for (let k = 1; k < 8; k++) {
							probe.lerpVectors(tops[i - 1], tops[i], k / 8);
							short = Math.max(short, clear - (probe.y - diorama.heightAt(probe.x, probe.z)));
						}
						tops[i - 1].y += short;
						tops[i].y += short;
					}
			}
			// Which way the line runs on the map, to turn the stations, tower arms and carriers.
			const bearing = Math.atan2(
				tops[tops.length - 1].x - tops[0].x,
				tops[tops.length - 1].z - tops[0].z
			);
			const heading = new THREE.Quaternion().setFromAxisAngle(up, bearing);
			const back = new THREE.Quaternion().setFromAxisAngle(up, bearing + Math.PI);
			const stationSource = perFeature(stationModel, feature);
			// Until a model has loaded, the built-in station stands in for it.
			const station = typeof stationSource === 'string' ? models[stationSource] : stationSource;
			// To the right of the line, where the carriers go up.
			const side = new THREE.Vector3(-Math.cos(bearing), 0, Math.sin(bearing));

			feet.forEach((foot, i) => {
				const end = i === 0 || i === feet.length - 1;
				if (end && station && perFeature(stations, feature)) {
					// A copy shares the model's geometry and materials. It faces along the line.
					const copy = station.clone();
					const metres = (tops[i].y - foot.y) / unit;
					copy.getObjectByName('Mast')?.scale.setY(metres);
					copy.getObjectByName('Head')?.position.setY(metres);
					copy.position.copy(foot);
					copy.quaternion.copy(i ? back : heading);
					copy.scale.setScalar(unit);
					copy.traverse((o) => (o.castShadow = o.receiveShadow = true));
					placed.push(copy);
					const wheel = copy.getObjectByName('Bullwheel');
					// The rim keeps pace with the cable, half the gauge out from the hub.
					if (wheel)
						wheels.push({ wheel, turn: diorama.metres(perFeature(speed, feature)) / half });
				} else if (end && perFeature(stations, feature)) {
					// A shed over the end of the line, set into the slope, that the carriers turn in.
					const sunk = unit * 2.5;
					const size = new THREE.Vector3(
						unit * (GAUGE + 4),
						cableHeight + unit * 2 + sunk,
						unit * 14
					);
					block(foot.clone().setY(foot.y + size.y / 2 - sunk), size, heading, structure);
				} else {
					// A low line, such as a rope tow, stands on posts in proportion.
					const girth = unit * Math.min(1, perFeature(height, feature) / 8);
					rod(foot.clone().setY(foot.y - unit), tops[i], girth * 0.8, structure);
					const arm = new THREE.Vector3(unit * (GAUGE + 1), girth * 0.5, girth * 0.5);
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
			const shuttling = perFeature(shuttle, feature);
			const count = shuttling ? 2 : Math.max(1, Math.round(loop / diorama.metres(spacing)));
			const source = perFeature(carrierModel, feature);
			// Until a model has loaded, the built-in carrier stands in for it.
			const model = typeof source === 'string' ? models[source] : source;
			let meshes: THREE.InstancedMesh[];
			// The colour of the block: the carrier's own, or that of most of the model.
			let c = new THREE.Color(perFeature(carrierColor, feature));
			if (model) {
				const shapes = modelShapes(model, perFeature(carrierParts, feature));
				meshes = shapes.map(
					(shape) => new THREE.InstancedMesh(shape.geometry, shape.material, count)
				);
				const most = shapes.reduce((a, b) =>
					b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a
				);
				c = (most.material as THREE.MeshStandardMaterial).color ?? c;
			} else {
				const mesh = new THREE.InstancedMesh(
					carrierGeometry(perFeature(carrier, feature), perFeature(carrierSize, feature)),
					material,
					count
				);
				for (let i = 0; i < count; i++) mesh.setColorAt(i, c);
				meshes = [mesh];
			}
			const extent = new THREE.Box3();
			for (const mesh of meshes) {
				mesh.geometry.computeBoundingBox();
				extent.union(mesh.geometry.boundingBox!);
			}
			const size = extent.getSize(new THREE.Vector3());
			const centre = extent.getCenter(new THREE.Vector3());
			const blockShape = new THREE.BoxGeometry(size.x, size.y, size.z).translate(
				centre.x,
				centre.y,
				centre.z
			);
			blocks.push(blockShape);
			const standIn = new THREE.InstancedMesh(blockShape, material, count);
			for (let i = 0; i < count; i++) standIn.setColorAt(i, c);
			for (const mesh of meshes) mesh.visible = false;
			return {
				meshes,
				block: standIn,
				tall: size.y * unit,
				bounds: new THREE.Sphere().setFromPoints(tops),
				path: tops,
				lengths,
				gap: loop / count,
				shuttle: shuttling,
				pace: diorama.metres(perFeature(speed, feature)),
				side,
				turns: [heading, back],
				scale: new THREE.Vector3(unit, unit, unit)
			};
		});

		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		/** Put every carrier where it has got to, `seconds` after the last time. */
		const place = (seconds: number) => {
			fleets.forEach((fleet, n) => {
				if (!fleet) return;
				const { path, lengths, side, turns, scale } = fleet;
				const meshes = [...fleet.meshes, fleet.block];
				const count = fleet.block.count;
				const length = lengths[lengths.length - 1];
				const moved = ((travelled[n] ?? 0) + fleet.pace * seconds) % (length * 2);
				travelled[n] = moved;
				for (let i = 0; i < count; i++) {
					let d = (i * fleet.gap + moved) % (length * 2);
					let down = d > length;
					if (down) d = length * 2 - d;
					// The two of a shuttle are half a loop apart, so one is up when the other is
					// down; each keeps its side and its facing instead of turning at the ends.
					if (fleet.shuttle) down = i === 1;
					let k = 1;
					while (k < path.length - 1 && lengths[k] < d) k++;
					const span = lengths[k] - lengths[k - 1] || 1;
					position
						.lerpVectors(path[k - 1], path[k], (d - lengths[k - 1]) / span)
						.addScaledVector(side, down ? -half : half);
					matrix.compose(position, turns[down ? 1 : 0], scale);
					for (const mesh of meshes) mesh.setMatrixAt(i, matrix);
				}
				for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
			});
			for (const { wheel, turn } of wheels) wheel.rotation.y += turn * seconds;
			diorama.stage.invalidate();
		};
		place(0);
		let stop: (() => void) | undefined;
		if (fleets.some((fleet) => fleet?.pace) || wheels.some(({ turn }) => turn)) {
			let last = performance.now();
			stop = diorama.stage.onFrame(() => {
				const now = performance.now();
				// A tab left in the background picks up where it was, without a jump.
				place(Math.min(0.1, (now - last) / 1000));
				last = now;
			});
		}
		// Each lift's carriers in full where they are large enough on screen to tell from a block.
		const stopDetail = diorama.stage.onFrame(() => {
			const { camera, renderer } = diorama.stage;
			const perUnit =
				renderer.domElement.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
			for (const fleet of fleets) {
				if (!fleet) continue;
				const distance = Math.max(
					camera.near,
					camera.position.distanceTo(fleet.bounds.center) - fleet.bounds.radius
				);
				const full = !fleet.block.visible;
				const show = (fleet.tall * perUnit) / distance > DETAIL[full ? 1 : 0];
				if (show === full) continue;
				fleet.block.visible = !show;
				for (const mesh of fleet.meshes) mesh.visible = show;
				diorama.stage.invalidate();
			}
		});

		const meshes: THREE.InstancedMesh[] = Object.values(parts).map(({ geometry, at, colors }) => {
			const mesh = new THREE.InstancedMesh(geometry, material, at.length);
			at.forEach((m, i) => mesh.setMatrixAt(i, m));
			colors.forEach((c, i) => mesh.setColorAt(i, c));
			return mesh;
		});
		for (const mesh of meshes) mesh.castShadow = mesh.receiveShadow = true;
		// The carriers cast no shadow: the shadows are only redrawn when the scene changes, not
		// every frame for what moves through it.
		for (const fleet of fleets) {
			if (!fleet) continue;
			for (const mesh of [...fleet.meshes, fleet.block]) mesh.receiveShadow = true;
			meshes.push(...fleet.meshes, fleet.block);
		}
		const wire = new THREE.BufferGeometry();
		wire.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
		wire.setAttribute('color', new THREE.Float32BufferAttribute(cableColors, 3));
		const wireMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
		const wires = new THREE.LineSegments(wire, wireMaterial);
		diorama.group.add(...meshes, wires, ...placed);
		return () => {
			stop?.();
			stopDetail();
			diorama.group.remove(...meshes, wires, ...placed);
			for (const mesh of meshes) mesh.dispose();
			for (const geometry of [post, box, ...carriers.values(), ...posed, ...blocks, wire])
				geometry.dispose();
			material.dispose();
			wireMaterial.dispose();
		};
	});
</script>
