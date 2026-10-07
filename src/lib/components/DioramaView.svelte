<!--
	three.js viewport for a diorama: orbit with drag, zoom with wheel or pinch. Height changes
	(exaggeration, base) and contour lines update in place; a new `data` swaps the mesh and
	keeps the camera where it is.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import {
		createStage,
		createTerrainMaterial,
		exportDioramaGlb,
		type Stage
	} from '@liquidx/diorama';
	import { applyVertical, type DioramaData } from '$lib/diorama/geometry';

	type Props = {
		data: DioramaData | null;
		exaggeration?: number;
		/** Base thickness as a fraction of the radius. */
		baseDepth?: number;
		/** Contour interval in metres, 0 disables. */
		contourInterval?: number;
		/** Every nth contour is drawn heavier, 0 disables. */
		majorEvery?: number;
		autoRotate?: boolean;
		rotateSpeed?: number;
		/** Draw the triangle edges over the shaded surface. */
		wireframe?: boolean;
		/** Shown in the middle of the viewport while there is no model. */
		hint?: string;
	};

	let {
		data,
		exaggeration = 1,
		baseDepth = 0.25,
		contourInterval = 20,
		majorEvery = 5,
		autoRotate = true,
		rotateSpeed = 1.2,
		wireframe = false,
		hint = ''
	}: Props = $props();

	let container: HTMLDivElement;
	let stage: Stage | undefined = $state.raw();
	const { material, uniforms } = createTerrainMaterial();
	const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.visible = false;
	// Triangle edges, sharing the mesh's geometry. Kept out of `mesh` so it is not exported.
	const wireMaterial = new THREE.MeshBasicMaterial({
		color: 0x1a1208,
		wireframe: true,
		transparent: true,
		opacity: 0.4,
		depthWrite: false
	});
	const wire = new THREE.Mesh(mesh.geometry, wireMaterial);
	wire.visible = false;

	onMount(() => {
		const s = createStage(container);
		s.scene.add(mesh, wire);
		stage = s;
		return () => {
			stage = undefined;
			s.dispose();
			mesh.geometry.dispose();
			material.dispose();
			wireMaterial.dispose();
		};
	});

	// Swap in new geometry.
	$effect(() => {
		const next = data?.geometry ?? new THREE.BufferGeometry();
		if (mesh.geometry !== next) mesh.geometry.dispose();
		mesh.geometry = next;
		wire.geometry = next;
		mesh.visible = !!data;
		uniforms.uMinZ.value = data?.minZ ?? 0;
	});

	$effect(() => {
		if (data) applyVertical(data, { exaggeration, baseDepth });
	});

	$effect(() => {
		uniforms.uInterval.value = contourInterval;
		uniforms.uMajorEvery.value = majorEvery;
	});

	$effect(() => {
		wire.visible = wireframe && !!data;
		// Push the surface back a little so the edges on it are not z-fighting with it.
		material.polygonOffset = wireframe;
		material.polygonOffsetFactor = 1;
		material.polygonOffsetUnits = 1;
	});

	$effect(() => {
		if (!stage) return;
		stage.controls.autoRotate = autoRotate;
		stage.controls.autoRotateSpeed = rotateSpeed;
	});

	/** The current model as a binary glTF, viewable with `DioramaViewer` from `@liquidx/diorama`. */
	export async function glb(center?: { lon: number; lat: number }): Promise<Blob | null> {
		if (!data) return null;
		return exportDioramaGlb(mesh, {
			version: 1,
			minZ: data.minZ,
			maxZ: data.maxZ,
			radius: data.radius,
			...center,
			exaggeration,
			baseDepth,
			contourInterval,
			majorEvery
		});
	}
</script>

<div class="viewport" bind:this={container}>
	{#if !data && hint}<div class="hint">{hint}</div>{/if}
</div>

<style>
	.viewport {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--color-surface);
	}
	.hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--spacing-gutter);
		text-align: center;
		font-size: var(--text-small);
		color: var(--color-text-faint);
		pointer-events: none;
	}
</style>
