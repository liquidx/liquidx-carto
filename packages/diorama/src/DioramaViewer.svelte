<!--
	Renders a diorama GLB exported from the Mountain Diorama tool with its contour and soil
	shader. Orbit with drag, zoom with wheel or pinch. Contour settings default to those
	stored in the file and can be overridden. Fills its parent; give the parent a size.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { createStage, type Stage } from './stage.js';
	import { loadDioramaGlb, type DioramaMeta, type LoadedDiorama } from './format.js';

	type Props = {
		/** URL, Blob/File or ArrayBuffer of a diorama GLB. */
		src: string | Blob | ArrayBuffer | null | undefined;
		/** Contour interval in metres, 0 disables. Defaults to the value in the file. */
		contourInterval?: number;
		/** Every nth contour is drawn heavier, 0 disables. Defaults to the value in the file. */
		majorEvery?: number;
		autoRotate?: boolean;
		rotateSpeed?: number;
		onload?: (meta: DioramaMeta | null) => void;
		onerror?: (error: unknown) => void;
		class?: string;
	};

	let {
		src,
		contourInterval,
		majorEvery,
		autoRotate = true,
		rotateSpeed = 1.2,
		onload,
		onerror,
		class: className
	}: Props = $props();

	let container: HTMLDivElement;
	let stage: Stage | undefined = $state.raw();
	let model: LoadedDiorama | undefined = $state.raw();

	onMount(() => {
		const s = createStage(container);
		stage = s;
		return () => {
			stage = undefined;
			s.dispose();
		};
	});

	// Load (and replace) the model when the source changes.
	$effect(() => {
		const s = stage;
		if (!s || !src) return;
		let cancelled = false;
		let loaded: LoadedDiorama | undefined;
		loadDioramaGlb(src).then(
			(d) => {
				if (cancelled) return d.dispose();
				loaded = d;
				s.scene.add(d.mesh);
				model = d;
				onload?.(d.meta);
			},
			(e) => {
				if (!cancelled) onerror?.(e);
			}
		);
		return () => {
			cancelled = true;
			if (loaded) {
				s.scene.remove(loaded.mesh);
				loaded.dispose();
			}
			model = undefined;
		};
	});

	$effect(() => {
		const u = model?.uniforms;
		if (!u) return;
		u.uInterval.value = contourInterval ?? model?.meta?.contourInterval ?? 20;
		u.uMajorEvery.value = majorEvery ?? model?.meta?.majorEvery ?? 5;
	});

	$effect(() => {
		if (!stage) return;
		stage.controls.autoRotate = autoRotate;
		stage.controls.autoRotateSpeed = rotateSpeed;
	});
</script>

<div class={['diorama-viewer', className]} bind:this={container}></div>

<style>
	.diorama-viewer {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--diorama-background, transparent);
	}
</style>
