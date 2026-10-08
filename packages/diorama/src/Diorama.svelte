<!--
	A terrain diorama: either a GLB exported from the Mountain Diorama tool (`src`), or a mesh
	just built with `buildDiorama` (`data`), whose relief can then be changed in place. Orbit
	with drag, zoom with wheel or pinch. `terrain` picks how the surface is drawn; children such
	as `Drape` add to it and can find the model with `getDiorama()`. Fills its parent; give the
	parent a size.
-->
<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import * as THREE from 'three';
	import { applyVertical, dioramaMeta, type DioramaData } from './build.js';
	import { setDioramaContext, type DioramaContext } from './context.js';
	import { createDrapeCompositor } from './drape.js';
	import {
		createDioramaMesh,
		exportDioramaGlb,
		loadDioramaGlb,
		type DioramaMeta
	} from './format.js';
	import type { TerrainMaterial } from './material.js';
	import { createStage, DEFAULT_SUN, type Stage, type Sun } from './stage.js';
	import { resolveTerrainStyle, type TerrainPreset, type TerrainStyle } from './style.js';
	import { createSurface } from './surface.js';

	type Props = {
		/** URL, Blob/File or ArrayBuffer of a diorama GLB. */
		src?: string | Blob | ArrayBuffer | null;
		/**
		 * A mesh from `buildDiorama`, shown instead of `src`. The component takes it over: it sets
		 * its heights from `exaggeration` and `baseDepth`, and disposes of it when it is replaced.
		 */
		data?: DioramaData | null;
		/** Vertical exaggeration of `data`. A GLB keeps the relief it was exported with. */
		exaggeration?: number;
		/** Base thickness of `data` as a fraction of the radius. */
		baseDepth?: number;
		/** How the terrain is drawn: a preset name or your own style. */
		terrain?: TerrainPreset | TerrainStyle;
		/** Contour interval in metres, 0 disables. Defaults to the value in the file, or 20. */
		contourInterval?: number;
		/** Every nth contour is drawn heavier, 0 disables. Defaults to the value in the file, or 5. */
		majorEvery?: number;
		/** Size in pixels of the texture `Drape` children draw into. */
		drapeResolution?: number;
		/**
		 * Enlarges the objects placed on the terrain. At true scale a tree or a lift tower is a
		 * speck on a model several kilometres across.
		 */
		objectScale?: number;
		/** Draw the triangle edges over the shaded surface. Not part of an exported GLB. */
		wireframe?: boolean;
		/**
		 * Where the light comes from: `azimuth` as a compass bearing in degrees (90 is from the
		 * east), `elevation` in degrees above the horizon, and `intensity`. Fields left out keep
		 * the default, a sun in the south-west at 48°.
		 */
		sun?: Partial<Sun>;
		/**
		 * Colour behind the model, as any CSS colour. Without it the background is transparent, or
		 * whatever the `--diorama-background` custom property says.
		 */
		background?: string;
		/**
		 * How strongly `background` is shaded like a studio backdrop, brighter behind the model and
		 * darker towards the edges: 0 is flat, 1 is strong.
		 */
		backgroundGradient?: number;
		autoRotate?: boolean;
		rotateSpeed?: number;
		/**
		 * How close the view can zoom in, as a distance from what it looks at in radii of the
		 * model. Lower it to look closely at objects left at their true size.
		 */
		minDistance?: number;
		/** Called when a GLB from `src` has loaded. */
		onload?: (meta: DioramaMeta | null) => void;
		onerror?: (error: unknown) => void;
		class?: string;
		/** Layers on the terrain. Rendered while a diorama is shown. */
		children?: Snippet;
	};

	let {
		src,
		data,
		exaggeration = 1,
		baseDepth = 0.25,
		terrain = 'topo',
		contourInterval,
		majorEvery,
		drapeResolution = 2048,
		objectScale = 1,
		wireframe = false,
		sun,
		background,
		backgroundGradient = 0.5,
		autoRotate = true,
		rotateSpeed = 1.2,
		minDistance = 0.8,
		onload,
		onerror,
		class: className,
		children
	}: Props = $props();

	// A glow a little below the middle, where the model stands, falling off to darker corners.
	const backdrop = $derived.by(() => {
		if (!background) return undefined;
		const g = Math.min(1, Math.max(0, backgroundGradient));
		if (!g) return background;
		const mix = (other: string, amount: number) =>
			`color-mix(in oklab, ${background}, ${other} ${(amount * g).toFixed(1)}%)`;
		return `radial-gradient(ellipse 80% 70% at 50% 54%, ${mix('white', 24)} 0%, ${background} 55%, ${mix('black', 50)} 100%)`;
	});

	/** What is on the stage. `file` holds a GLB's own settings; a built mesh has none. */
	type Model = { mesh: THREE.Mesh; terrain: TerrainMaterial | null; file: DioramaMeta | null };

	let canvasHost: HTMLDivElement;
	let stage: Stage | undefined = $state.raw();
	let model: Model | undefined = $state.raw();
	let context: DioramaContext | undefined = $state.raw();
	setDioramaContext(() => context);

	/** Settings of the model on stage: a GLB's own with the contour props over them, or those of `data`. */
	const meta = $derived.by((): DioramaMeta | null => {
		if (!model) return null;
		if (model.file) {
			return {
				...model.file,
				contourInterval: contourInterval ?? model.file.contourInterval,
				majorEvery: majorEvery ?? model.file.majorEvery
			};
		}
		if (!data || model.mesh.geometry !== data.geometry) return null;
		return dioramaMeta(data, {
			exaggeration,
			baseDepth,
			contourInterval: contourInterval ?? 20,
			majorEvery: majorEvery ?? 5
		});
	});

	onMount(() => {
		const s = createStage(canvasHost);
		stage = s;
		return () => {
			stage = undefined;
			s.dispose();
		};
	});

	/** Put a model on the stage; returns the undo. */
	function show(s: Stage, next: Model, dispose: () => void) {
		next.mesh.castShadow = next.mesh.receiveShadow = true;
		s.scene.add(next.mesh);
		model = next;
		return () => {
			model = undefined;
			s.scene.remove(next.mesh);
			dispose();
		};
	}

	// A built mesh.
	$effect(() => {
		const s = stage;
		if (!s || !data) return;
		const { mesh, terrain: material } = createDioramaMesh(
			data,
			untrack(() => terrain)
		);
		const { geometry } = data;
		return show(s, { mesh, terrain: material, file: null }, () => {
			geometry.dispose();
			material.dispose();
		});
	});

	// A GLB, loaded (and replaced) when the source changes.
	$effect(() => {
		const s = stage;
		if (!s || !src || data) return;
		let cancelled = false;
		let cleanup: (() => void) | undefined;
		loadDioramaGlb(
			src,
			untrack(() => resolveTerrainStyle(terrain))
		).then(
			(d) => {
				if (cancelled) return d.dispose();
				cleanup = show(s, { mesh: d.mesh, terrain: d.terrain, file: d.meta }, d.dispose);
				onload?.(d.meta);
			},
			(e) => {
				if (!cancelled) onerror?.(e);
			}
		);
		return () => {
			cancelled = true;
			cleanup?.();
		};
	});

	// What the children work with. Anything that moves the surface (a new model, or new relief
	// for a built mesh) makes a new context, and with it new children.
	$effect(() => {
		const s = stage;
		const m = model;
		if (!s || !m?.terrain) return;
		let relief = m.file?.exaggeration;
		if (!m.file) {
			if (!data || m.mesh.geometry !== data.geometry) return;
			applyVertical(data, { exaggeration, baseDepth });
			relief = exaggeration;
		}
		m.terrain.uniforms.uExaggeration.value = relief ?? 1;
		const settings = untrack(() => meta);
		if (!settings) return;

		const surface = createSurface(m.mesh.geometry, settings);
		const group = new THREE.Group();
		s.scene.add(group);
		const drapes = createDrapeCompositor(m.terrain, {
			resolution: untrack(() => drapeResolution),
			anisotropy: Math.min(8, s.renderer.capabilities.getMaxAnisotropy())
		});
		const stopFrames = s.onFrame(drapes.update);
		context = {
			...surface,
			get meta() {
				return meta ?? settings;
			},
			size: (n) => surface.metres(n) * objectScale,
			group,
			stage: s,
			drapes
		};
		return () => {
			context = undefined;
			stopFrames();
			drapes.dispose();
			s.scene.remove(group);
		};
	});

	$effect(() => {
		model?.terrain?.setStyle(resolveTerrainStyle(terrain));
	});

	// Triangle edges, on a second mesh sharing the geometry so that they are not exported.
	$effect(() => {
		const s = stage;
		const m = model;
		if (!s || !m || !wireframe) return;
		const material = new THREE.MeshBasicMaterial({
			color: 0x1a1208,
			wireframe: true,
			transparent: true,
			opacity: 0.4,
			depthWrite: false
		});
		const wire = new THREE.Mesh(m.mesh.geometry, material);
		s.scene.add(wire);
		// Push the surface back a little so the edges on it are not z-fighting with it.
		const surface = m.mesh.material as THREE.Material;
		surface.polygonOffset = true;
		surface.polygonOffsetFactor = 1;
		surface.polygonOffsetUnits = 1;
		return () => {
			surface.polygonOffset = false;
			s.scene.remove(wire);
			material.dispose();
		};
	});

	$effect(() => {
		const u = model?.terrain?.uniforms;
		if (!u) return;
		u.uInterval.value = contourInterval ?? model?.file?.contourInterval ?? 20;
		u.uMajorEvery.value = majorEvery ?? model?.file?.majorEvery ?? 5;
	});

	$effect(() => {
		context?.drapes.setResolution(drapeResolution);
	});

	$effect(() => {
		stage?.setSun({ ...DEFAULT_SUN, ...sun });
	});

	$effect(() => {
		if (!stage) return;
		stage.controls.autoRotate = autoRotate;
		stage.controls.autoRotateSpeed = rotateSpeed;
	});

	$effect(() => {
		if (stage) stage.controls.minDistance = minDistance;
	});

	/** The terrain on show as a binary glTF that `src` can load. Layers are not included. */
	export async function glb(): Promise<Blob | null> {
		return model && meta ? exportDioramaGlb(model.mesh, meta) : null;
	}
</script>

<div class={['diorama', className]} style:background={backdrop}>
	<div class="canvas" bind:this={canvasHost}></div>
	{#if context}
		{#key context}{@render children?.()}{/key}
	{/if}
</div>

<style>
	.diorama {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--diorama-background, transparent);
	}
	.canvas {
		position: absolute;
		inset: 0;
	}
</style>
