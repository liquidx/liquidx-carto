<!--
	three.js viewport for a diorama: orbit with drag, zoom with wheel or pinch. Height changes
	(exaggeration, base) and contour lines update in place; a new `data` swaps the mesh and
	keeps the camera where it is.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
	import { applyVertical, type DioramaData } from '$lib/diorama/geometry';
	import { createTerrainMaterial } from '$lib/diorama/material';

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
		hint = ''
	}: Props = $props();

	let container: HTMLDivElement;
	let controls: OrbitControls | undefined = $state.raw();
	const scene = new THREE.Scene();
	const { material, uniforms } = createTerrainMaterial();
	const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.visible = false;
	scene.add(mesh);

	onMount(() => {
		const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		r.setPixelRatio(Math.min(2, window.devicePixelRatio));
		r.shadowMap.enabled = true;
		r.shadowMap.type = THREE.PCFShadowMap;
		r.toneMapping = THREE.ACESFilmicToneMapping;
		r.toneMappingExposure = 0.95;
		// eslint-disable-next-line svelte/no-dom-manipulating -- three.js owns this canvas
		container.appendChild(r.domElement);

		const cam = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
		cam.position.set(2.4, 1.9, 2.6);

		const c = new OrbitControls(cam, r.domElement);
		c.enableDamping = true;
		c.dampingFactor = 0.06;
		c.target.set(0, 0.15, 0);
		c.minDistance = 0.8;
		c.maxDistance = 12;
		c.maxPolarAngle = Math.PI * 0.55;
		controls = c;

		scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5a48, 0.55));
		const sun = new THREE.DirectionalLight(0xfff2e0, 1.7);
		sun.position.set(-2.5, 3.5, 2);
		sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048);
		Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6 });
		sun.shadow.camera.near = 0.5;
		sun.shadow.camera.far = 12;
		sun.shadow.bias = -0.0004;
		sun.shadow.normalBias = 0.01;
		scene.add(sun);
		const fill = new THREE.DirectionalLight(0xc8d8ff, 0.3);
		fill.position.set(3, 1, -2);
		scene.add(fill);

		const resize = () => {
			const w = container.clientWidth || 1;
			const h = container.clientHeight || 1;
			r.setSize(w, h, false);
			cam.aspect = w / h;
			cam.updateProjectionMatrix();
		};
		const ro = new ResizeObserver(resize);
		ro.observe(container);
		resize();

		let raf = 0;
		const loop = () => {
			raf = requestAnimationFrame(loop);
			c.update();
			r.render(scene, cam);
		};
		loop();

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			c.dispose();
			mesh.geometry.dispose();
			material.dispose();
			r.dispose();
			r.domElement.remove();
		};
	});

	// Swap in new geometry.
	$effect(() => {
		const next = data?.geometry ?? new THREE.BufferGeometry();
		if (mesh.geometry !== next) mesh.geometry.dispose();
		mesh.geometry = next;
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
		if (!controls) return;
		controls.autoRotate = autoRotate;
		controls.autoRotateSpeed = rotateSpeed;
	});

	/** The current model as a binary glTF. */
	export async function glb(): Promise<Blob | null> {
		if (!data) return null;
		const out = (await new GLTFExporter().parseAsync(mesh, { binary: true })) as ArrayBuffer;
		return new Blob([out], { type: 'model/gltf-binary' });
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
	.viewport :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
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
