<!--
	Text (or any markup) that floats over a place on the terrain and follows it as the view
	turns. Labels fade out while the terrain is in front of them, or while the view is further
	than `maxDistance`; the enclosing `<Diorama>` can hide them all with `labels`. Give `at` with content, or
	`data` with `text`: a line is labelled at its midpoint and a polygon at its centre.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import type { Snippet } from 'svelte';
	import * as THREE from 'three';
	import { getDiorama, type LabelVariant } from './context.js';
	import { featureShapes, type GeoJSONSource } from './geojson.svelte.js';
	import type { LonLat } from './surface.js';

	type Props = {
		/** Features to label: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		/** One position, instead of `data`. */
		at?: LonLat;
		filter?: (feature: Feature) => boolean;
		/** The text for a feature; return nothing to leave it unlabelled. */
		text?: (feature: Feature) => string | null | undefined;
		/**
		 * Height of the label's anchor above the ground in metres, enlarged by the diorama's
		 * `objectScale` so it clears the objects beneath it.
		 */
		altitude?: number;
		/** Hide a label that would overlap one earlier in the same `data`. */
		declutter?: boolean;
		/**
		 * Show the labels only while the view is at most this far from what it looks at, in
		 * radii of the model, like the diorama's `distance`. Without it they show at any zoom.
		 */
		maxDistance?: number;
		/** How the label stands off the terrain. Defaults to the diorama's `labelVariant`. */
		variant?: LabelVariant;
		class?: string;
		/** Content of each label, in place of `text`. */
		children?: Snippet<[feature: Feature]>;
	};

	let {
		data,
		at,
		filter,
		text,
		altitude = 30,
		declutter = true,
		maxDistance = Infinity,
		variant,
		class: className,
		children
	}: Props = $props();

	const diorama = getDiorama();
	const shapes = featureShapes(
		() => data ?? (at ? { type: 'Point', coordinates: [...at] } : null),
		() => filter
	);

	/** Where a shape is labelled, in model x and z. */
	function anchor(kind: string, coords: number[][][]): [number, number] {
		const path = coords[0].map(diorama.toModel);
		if (kind === 'point') return path[0];
		if (kind === 'polygon') {
			// The mean of the outline's corners, leaving out the repeated closing one.
			const corners = path.slice(0, -1);
			return [
				corners.reduce((sum, p) => sum + p[0], 0) / corners.length,
				corners.reduce((sum, p) => sum + p[1], 0) / corners.length
			];
		}
		// Halfway along the line.
		const steps = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
		let remaining = steps.reduce((sum, d) => sum + d, 0) / 2;
		for (let i = 0; i < steps.length; i++) {
			if (remaining <= steps[i]) {
				const t = remaining / (steps[i] || 1);
				return [
					path[i][0] + (path[i + 1][0] - path[i][0]) * t,
					path[i][1] + (path[i + 1][1] - path[i][1]) * t
				];
			}
			remaining -= steps[i];
		}
		return path[path.length - 1];
	}

	const labels = $derived(
		shapes.current
			.filter((s) => s.coords[0].length > 0)
			.map((s) => {
				const [x, z] = anchor(s.kind, s.coords);
				return {
					feature: s.feature,
					caption: text?.(s.feature),
					position: new THREE.Vector3(x, diorama.heightAt(x, z) + diorama.size(altitude), z)
				};
			})
			.filter((label) => children || label.caption)
	);

	let elements: (HTMLElement | undefined)[] = $state([]);

	/** True when the terrain rises above the straight line from `point` towards the camera. */
	const probe = new THREE.Vector3();
	function hidden(point: THREE.Vector3, eye: THREE.Vector3) {
		const reach = Math.min(point.distanceTo(eye), 2.5);
		const step = probe
			.copy(eye)
			.sub(point)
			.normalize()
			.multiplyScalar(reach / 40);
		let { x, y, z } = point;
		for (let i = 0; i < 40; i++) {
			x += step.x;
			y += step.y;
			z += step.z;
			if (x * x + z * z > 1) return false;
			if (y < diorama.heightAt(x, z)) return true;
		}
		return false;
	}

	// Follow the camera: place each label over its anchor before every frame.
	const screen = new THREE.Vector3();
	$effect(() => {
		const current = labels;
		const { camera, controls, renderer } = diorama.stage;
		// Measured once here, so that frames only write styles.
		const sizes = current.map((_, i) => [
			elements[i]?.offsetWidth ?? 0,
			elements[i]?.offsetHeight ?? 0
		]);
		const taken: number[][] = [];
		return diorama.stage.onFrame(() => {
			camera.updateMatrixWorld();
			const { clientWidth: w, clientHeight: h } = renderer.domElement;
			taken.length = 0;
			const near = camera.position.distanceTo(controls.target) <= maxDistance;
			current.forEach((label, i) => {
				const element = elements[i];
				if (!element) return;
				screen.copy(label.position).project(camera);
				const x = ((screen.x + 1) / 2) * w;
				const y = ((1 - screen.y) / 2) * h;
				let visible = near && screen.z < 1 && !hidden(label.position, camera.position);
				if (visible && declutter) {
					// The label sits centred above its anchor.
					const box = [x - sizes[i][0] / 2, y - sizes[i][1], x + sizes[i][0] / 2, y];
					visible = !taken.some(
						(t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]
					);
					if (visible) taken.push(box);
				}
				element.style.opacity = visible ? '1' : '0';
				element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
			});
		});
	});
</script>

{#if diorama.labels.visible}
	{#each labels as label, i (i)}
		<div
			class={['diorama-label', variant ?? diorama.labels.variant, className]}
			bind:this={elements[i]}
		>
			{#if children}{@render children(label.feature)}{:else}{label.caption}{/if}
		</div>
	{/each}
{/if}

<style>
	.diorama-label {
		position: absolute;
		top: 0;
		left: 0;
		font-size: var(--diorama-label-size, 11px);
		line-height: 1.2;
		white-space: nowrap;
		/* Shown once placed. */
		opacity: 0;
		pointer-events: none;
		will-change: transform;
		transition: opacity 0.2s;
	}
	.light,
	.dark {
		/* Lifted off the anchor so the pill does not sit on the point it names. */
		margin-top: -3px;
		padding: 2px 7px;
		border-radius: 999px;
	}
	.light {
		color: var(--diorama-label-color, #16191d);
		background: var(--diorama-label-background, #fff);
	}
	.dark {
		color: var(--diorama-label-color, #fff);
		background: var(--diorama-label-background, rgb(0 0 0 / 0.6));
	}
	.halo {
		padding-bottom: 2px;
		color: var(--diorama-label-color, #16191d);
		/* A halo keeps the text readable over any terrain. */
		text-shadow:
			0 0 2px var(--diorama-label-halo, #fff),
			0 0 2px var(--diorama-label-halo, #fff),
			0 0 4px var(--diorama-label-halo, #fff);
	}
</style>
