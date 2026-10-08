<!--
	Snowboarders: for each line in `data`, a stream of little riders carving down it from the
	high end to the low end at a realistic pace, then starting again at the top. Each rider is a
	board with a bent-kneed figure on it, true to size, so they only show when zoomed in or the
	diorama's `objectScale` is raised.
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
		/** Runs to ride: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		filter?: (feature: Feature) => boolean;
		/** Average distance between riders along a run in metres, 0 for none. */
		every?: PerFeature<number>;
		/**
		 * Average speed down the run in metres a second: about 8 for a gentle cruise, 11 for a
		 * typical intermediate and 15 for a confident rider on a steep groomer. Each rider goes
		 * a little faster or slower than this. 0 stands them still.
		 */
		speed?: PerFeature<number>;
		/** Height of a rider in metres, board to helmet. */
		height?: number;
		/** How far the carves swing either side of the run's line, in metres. */
		carve?: number;
		/** Jacket colours, one picked at random for each rider. */
		colors?: THREE.ColorRepresentation[];
	};

	let {
		data,
		filter,
		every = 100,
		speed = 10,
		height = 1.7,
		carve = 4,
		colors = ['#e03131', '#f08c00', '#1971c2', '#2f9e44', '#862e9c', '#212529', '#f8f9fa']
	}: Props = $props();

	const diorama = getDiorama();
	const runs = featureShapes(
		() => data,
		() => filter
	);

	// How far down its run each rider has got, as a fraction of the run, so that they carry on
	// from where they were when the riders are rebuilt (for a new object scale, say).
	const progress: number[] = [];

	$effect(() => {
		const paths = runs.current.filter((s) => s.kind === 'line' && s.coords[0].length > 1);
		if (!paths.length) return;

		const unit = diorama.size(height);
		const metres = (n: number) => diorama.metres(n);
		const swing = diorama.size(carve);

		// One rider, one unit tall, standing at the origin on a board along +z. Snowboarders
		// stand across the board, so the shoulders run along z and the figure faces +x.
		const part = (w: number, h: number, d: number, x: number, y: number, z = 0) =>
			new THREE.BoxGeometry(w, h, d).translate(x, y, z);
		const pieces = [
			part(0.16, 0.012, 0.9, 0, 0.006), // board, about 1.5 m long
			part(0.14, 0.2, 0.11, 0.03, 0.14, -0.16), // back leg, bent so the hips sit low
			part(0.14, 0.2, 0.11, 0.03, 0.14, 0.16), // front leg
			part(0.14, 0.14, 0.18, -0.02, 0.3, -0.12), // thighs angling in to the hips
			part(0.14, 0.14, 0.18, -0.02, 0.3, 0.12),
			part(0.17, 0.25, 0.27, -0.04, 0.5, 0), // torso, leaning a little forward
			part(0.07, 0.2, 0.07, 0.07, 0.42, -0.19), // arms out for balance
			part(0.07, 0.2, 0.07, 0.07, 0.42, 0.19),
			new THREE.SphereGeometry(0.075, 10, 8).translate(-0.04, 0.705, 0) // helmet
		];
		const rider = mergeGeometries(pieces).scale(unit, unit, unit);
		for (const piece of pieces) piece.dispose();
		const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });

		/** A run as a path over the terrain, with the distance along it to each point. */
		type Run = {
			path: THREE.Vector3[];
			lengths: number[];
			/** Model units a second. */
			pace: number;
		};
		const run = ({ coords, feature }: (typeof paths)[number]): Run | undefined => {
			const spacing = perFeature(every, feature);
			if (!(spacing > 0)) return;
			// Ride downhill whichever way the line is drawn.
			const line =
				diorama.elevationAt(coords[0][0]) < diorama.elevationAt(coords[0][coords[0].length - 1])
					? [...coords[0]].reverse()
					: coords[0];
			// Resample every few metres so the riders follow the ground between the line's points.
			const flat = line.map((p) => {
				const [x, z] = diorama.toModel(p);
				return new THREE.Vector3(x, 0, z);
			});
			const step = metres(8);
			const path: THREE.Vector3[] = [];
			for (let i = 1; i < flat.length; i++) {
				const span = flat[i].distanceTo(flat[i - 1]);
				const n = Math.max(1, Math.ceil(span / step));
				for (let j = i === 1 ? 0 : 1; j <= n; j++) {
					const p = flat[i - 1].clone().lerp(flat[i], j / n);
					path.push(p.setY(diorama.heightAt(p.x, p.z)));
				}
			}
			const lengths = [0];
			for (let i = 1; i < path.length; i++)
				lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
			return { path, lengths, pace: metres(perFeature(speed, feature)) };
		};

		/** Every rider on the hill: which run, and their own quirks. */
		type Skier = {
			run: Run;
			/** Their speed as a multiple of the run's. */
			pace: number;
			/** Where in the carve they are, and how wide and long their turns are. */
			phase: number;
			width: number;
			turn: number;
		};
		// Seeded, so the same riders come back after a rebuild.
		let seed = 1234;
		const random = () => {
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return seed / 4294967296;
		};
		const skiers: Skier[] = [];
		for (const shape of paths) {
			const r = run(shape);
			if (!r) continue;
			const length = r.lengths[r.lengths.length - 1];
			const count = Math.round(length / metres(perFeature(every, shape.feature)));
			for (let i = 0; i < count; i++) {
				const n = skiers.length;
				progress[n] ??= random();
				skiers.push({
					run: r,
					pace: 0.75 + random() * 0.5,
					phase: random() * Math.PI * 2,
					width: 0.5 + random(),
					turn: metres(25 + random() * 25)
				});
			}
		}
		if (!skiers.length) {
			rider.dispose();
			material.dispose();
			return;
		}

		const mesh = new THREE.InstancedMesh(rider, material, skiers.length);
		// No shadow of their own: the shadows are only redrawn when the scene changes, not every
		// frame for what moves through it.
		mesh.receiveShadow = true;
		const palette = colors.map((c) => new THREE.Color(c));
		for (let i = 0; i < skiers.length; i++)
			mesh.setColorAt(i, palette[Math.floor(random() * palette.length)]);

		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const ahead = new THREE.Vector3();
		const forward = new THREE.Vector3();
		const side = new THREE.Vector3();
		const up = new THREE.Vector3(0, 1, 0);
		const look = new THREE.Matrix4();
		const turn = new THREE.Quaternion();
		const lean = new THREE.Quaternion();
		const scale = new THREE.Vector3(1, 1, 1);
		/** The point `d` along a run, into `out`. */
		const at = ({ path, lengths }: Run, d: number, out: THREE.Vector3) => {
			let k = 1;
			while (k < path.length - 1 && lengths[k] < d) k++;
			const span = lengths[k] - lengths[k - 1] || 1;
			return out.lerpVectors(path[k - 1], path[k], (d - lengths[k - 1]) / span);
		};
		/** Put every rider where they have got to, `seconds` after the last time. */
		const place = (seconds: number) => {
			skiers.forEach((skier, i) => {
				const { run } = skier;
				const length = run.lengths[run.lengths.length - 1];
				const fraction = (progress[i] + (run.pace * skier.pace * seconds) / length) % 1;
				progress[i] = fraction;
				const d = fraction * length;
				at(run, d, position);
				at(run, Math.min(length, d + metres(5)), ahead);
				forward.subVectors(ahead, position);
				if (forward.lengthSq() < 1e-12) forward.set(0, 0, 1);
				forward.normalize();
				side.crossVectors(up, forward).normalize();
				// Carve: swing from side to side across the line, and point the board along the
				// swing while leaning into it.
				const angle = (d / skier.turn) * Math.PI * 2 + skier.phase;
				const offset = Math.sin(angle) * swing * skier.width;
				const drift = Math.cos(angle) * swing * skier.width * ((Math.PI * 2) / skier.turn);
				position.addScaledVector(side, offset);
				position.y = diorama.heightAt(position.x, position.z);
				ahead.copy(position).add(forward).addScaledVector(side, drift);
				look.lookAt(ahead, position, up);
				turn.setFromRotationMatrix(look);
				lean.setFromAxisAngle(forward, -Math.sin(angle) * 0.35 * skier.width);
				mesh.setMatrixAt(i, matrix.compose(position, lean.multiply(turn), scale));
			});
			mesh.instanceMatrix.needsUpdate = true;
			diorama.stage.invalidate();
		};
		place(0);
		let stop: (() => void) | undefined;
		if (skiers.some((s) => s.run.pace)) {
			let last = performance.now();
			stop = diorama.stage.onFrame(() => {
				const now = performance.now();
				// A tab left in the background picks up where it was, without a jump.
				place(Math.min(0.1, (now - last) / 1000));
				last = now;
			});
		}

		diorama.group.add(mesh);
		return () => {
			stop?.();
			diorama.group.remove(mesh);
			mesh.dispose();
			rider.dispose();
			material.dispose();
		};
	});
</script>
