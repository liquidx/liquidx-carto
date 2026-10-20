<!-- The photographic preview: a WebGL canvas drawn by `FujiScene`, redrawn whenever its inputs change. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import type * as THREE from 'three';
	import type { Observer, TerrainGrid } from './alignment';
	import { FujiScene, type Conditions, type SunState } from './scene';

	type Props = {
		grids: TerrainGrid[] | null;
		observer: Observer;
		sun: SunState;
		bearing: number;
		pitch: number;
		conditions: Conditions;
		/** Building meshes in the scene's frame, about the observer. */
		buildings?: THREE.BufferGeometry[];
		/** Keep redrawing so the clouds drift. */
		animate?: boolean;
	};

	let {
		grids,
		observer,
		sun,
		bearing,
		pitch,
		conditions,
		buildings = [],
		animate = false
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let scene: FujiScene | null = $state.raw(null);
	let frame = 0;

	onMount(() => {
		const s = new FujiScene(canvas);
		scene = s;
		if (import.meta.env.DEV) (window as unknown as { __fuji: FujiScene }).__fuji = s;
		const ro = new ResizeObserver(() => {
			const r = canvas.getBoundingClientRect();
			s.resize(Math.round(r.width), Math.round(r.height));
			draw();
		});
		ro.observe(canvas);
		return () => {
			ro.disconnect();
			cancelAnimationFrame(frame);
			s.dispose();
			scene = null;
		};
	});

	function draw() {
		if (!scene || !grids) return;
		scene.render(sun, bearing, pitch, conditions);
	}

	// The ground only needs rebuilding when the terrain or the observer changes.
	$effect(() => {
		if (!scene || !grids) return;
		scene.setTerrain(grids, observer);
		draw();
	});

	$effect(() => {
		if (!scene) return;
		scene.setBuildings(buildings);
		draw();
	});

	$effect(() => {
		// Read everything the frame depends on, so any change redraws.
		void [sun, bearing, pitch, conditions];
		draw();
	});

	$effect(() => {
		if (!animate) return;
		const tick = () => {
			draw();
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});
</script>

<canvas bind:this={canvas} class:loading={!grids}></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--color-map-ink);
	}
	.loading {
		opacity: 0.4;
	}
</style>
