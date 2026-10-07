<!--
	The rider on the minimap diorama: an arrow on a pin that follows the board every frame
	and points the way it is heading. Must sit inside `<Diorama>`.
-->
<script lang="ts">
	import * as THREE from 'three';
	import { getDiorama } from '@liquidx/diorama';
	import type { Game } from './game';

	type Props = { game: Game; color?: string };
	let { game, color = '#36b6e9' }: Props = $props();

	const diorama = getDiorama();

	$effect(() => {
		const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
		// Sizes in model units: an arrowhead lying flat, on a pin so it clears the trees.
		const size = diorama.size(30);
		const arrow = new THREE.ConeGeometry(size * 0.5, size * 1.4, 4).rotateZ(-Math.PI / 2);
		const pin = new THREE.CylinderGeometry(size * 0.05, size * 0.05, size * 1.2, 6).translate(
			0,
			-size * 0.6,
			0
		);
		const group = new THREE.Group().add(
			new THREE.Mesh(arrow, material),
			new THREE.Mesh(pin, material)
		);
		group.traverse((o) => (o.castShadow = true));
		diorama.group.add(group);
		const stop = diorama.stage.onFrame(() => {
			diorama.project(game.riderLonLat(), 40, group.position);
			// The heading is an angle in the x–z plane; model axes match the game's.
			group.rotation.y = -game.rider.heading;
		});
		return () => {
			stop();
			diorama.group.remove(group);
			arrow.dispose();
			pin.dispose();
			material.dispose();
		};
	});
</script>
