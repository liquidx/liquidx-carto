<!--
	Frames the minimap diorama: from straight above, turned every frame so the way the rider is
	going is up the map. Dragging tilts it and the wheel zooms, kept close so the model never
	shrinks to a dot. Must sit inside `<Diorama>`.
-->
<script lang="ts">
	import * as THREE from 'three';
	import { getDiorama } from '@liquidx/diorama';
	import type { Game } from './game';

	type Props = { game: Game };
	let { game }: Props = $props();

	const diorama = getDiorama();
	/** Just off vertical: straight down has no way up for the camera. */
	const TOP_DOWN = 0.08;
	/** Slower than this, in metres a second, the rider's facing stands in for their direction. */
	const MOVING = 2.5;

	$effect(() => {
		const { camera, controls } = diorama.stage;
		controls.target.set(0, 0.1, 0);
		controls.minDistance = 1.2;
		controls.maxDistance = 4;
		controls.minPolarAngle = TOP_DOWN;
		const view = new THREE.Spherical(2.9, TOP_DOWN, 0);
		const offset = new THREE.Vector3();
		let first = true;
		let last = performance.now();
		const stop = diorama.stage.onFrame(() => {
			const now = performance.now();
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			const { rider } = game;
			const moving = rider.mode !== 'lift' && rider.speed > MOVING;
			const way = moving ? Math.atan2(rider.velocity.z, rider.velocity.x) : rider.heading;
			// The azimuth that puts `way` up the screen; model axes match the game's.
			const goal = Math.atan2(-Math.cos(way), -Math.sin(way));
			if (first) view.theta = goal;
			else {
				// Keep the tilt and zoom the orbit controls were left at, and ease the turn the short way.
				view.setFromVector3(offset.copy(camera.position).sub(controls.target));
				const turn = Math.atan2(Math.sin(goal - view.theta), Math.cos(goal - view.theta));
				view.theta += turn * (1 - Math.exp(-dt * 4));
			}
			first = false;
			camera.position.setFromSpherical(view).add(controls.target);
			controls.update();
			// The stage only draws when asked.
			if (Math.abs(goal - view.theta) > 1e-4) diorama.stage.invalidate();
		});
		return stop;
	});
</script>
