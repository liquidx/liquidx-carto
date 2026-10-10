<!--
	The rider on the minimap diorama: an arrow on a pin that follows the board every frame
	and points the way it is heading. The arrow keeps its size on screen, however big the resort
	is and however far the map is zoomed. Must sit inside `<Diorama>`.
-->
<script lang="ts">
	import * as THREE from 'three';
	import { getDiorama } from '@liquidx/diorama';
	import type { Game } from './game';

	type Props = {
		game: Game;
		color?: string;
		/** How far above the snow the arrow floats, in metres, to clear what stands on it. */
		clear?: number;
	};
	let { game, color = '#36b6e9', clear = 40 }: Props = $props();

	const diorama = getDiorama();
	/** The arrow's length as a fraction of its distance from the camera. */
	const SIZE = 0.055;

	$effect(() => {
		const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
		// An arrowhead one unit long lying flat, and a pin one unit tall hanging below the origin;
		// both are scaled every frame.
		const arrow = new THREE.Mesh(
			new THREE.ConeGeometry(0.36, 1, 4).rotateZ(-Math.PI / 2),
			material
		);
		const pin = new THREE.Mesh(
			new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, -0.5, 0),
			material
		);
		arrow.castShadow = pin.castShadow = true;
		diorama.group.add(arrow, pin);
		const ground = new THREE.Vector3();
		let drawn = '';
		const stop = diorama.stage.onFrame(() => {
			const at = game.riderLonLat();
			diorama.project(at, clear, arrow.position);
			diorama.project(at, 0, ground);
			const size = arrow.position.distanceTo(diorama.stage.camera.position) * SIZE;
			arrow.scale.setScalar(size);
			// The heading is an angle in the x–z plane; model axes match the game's.
			arrow.rotation.y = -game.rider.heading;
			pin.position.copy(arrow.position);
			pin.scale.set(size * 0.07, arrow.position.y - ground.y, size * 0.07);
			// The stage only draws when asked.
			const now = `${at[0]},${at[1]},${game.rider.heading},${size}`;
			if (now !== drawn) diorama.stage.invalidate();
			drawn = now;
		});
		return () => {
			stop();
			diorama.group.remove(arrow, pin);
			arrow.geometry.dispose();
			pin.geometry.dispose();
			material.dispose();
		};
	});
</script>
