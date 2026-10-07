<!--
	A compass in a corner of the enclosing `<Diorama>`: its needle points to where north is on
	screen and turns with the view. `sun` adds a dot on the rim on the side the light comes
	from. Click it to turn the view north-up.
-->
<script lang="ts">
	import * as THREE from 'three';
	import { getDiorama } from './context.js';

	type Props = {
		corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
		/** Mark the direction the light comes from. */
		sun?: boolean;
		/** Accessible name of the button. */
		label?: string;
		class?: string;
	};

	let {
		corner = 'top-right',
		sun = false,
		label = 'Turn the view north-up',
		class: className
	}: Props = $props();

	const { stage } = getDiorama();

	let dial: SVGGElement;
	let sunMark: SVGCircleElement | undefined = $state();

	// With the camera due south of the model north is up, so the dial turns by the camera's
	// bearing round the model. Written straight to the DOM, as it changes every frame.
	$effect(() => {
		const mark = sunMark;
		let turned = NaN;
		let lit = NaN;
		return stage.onFrame(() => {
			const bearing = THREE.MathUtils.radToDeg(stage.controls.getAzimuthalAngle());
			if (bearing !== turned) dial.setAttribute('transform', `rotate(${(turned = bearing)})`);
			if (mark && stage.sun.azimuth !== lit) {
				mark.setAttribute('transform', `rotate(${(lit = stage.sun.azimuth)})`);
			}
		});
	});

	/** Swing the camera round to the south of the model, keeping its height and distance. */
	function faceNorth() {
		const { camera, controls } = stage;
		const offset = new THREE.Spherical().setFromVector3(
			camera.position.clone().sub(controls.target)
		);
		const from = offset.theta;
		const started = performance.now();
		const stop = stage.onFrame(() => {
			const t = Math.min(1, (performance.now() - started) / 400);
			// Ease out; theta runs from -π to π, so going to 0 is always the short way round.
			offset.theta = from * (1 - t) ** 3;
			camera.position.setFromSpherical(offset).add(controls.target);
			if (t === 1) stop();
		});
	}
</script>

<button
	type="button"
	class={['diorama-compass', corner, className]}
	aria-label={label}
	title={label}
	onclick={faceNorth}
>
	<svg viewBox="-24 -24 48 48" aria-hidden="true">
		<g bind:this={dial}>
			<circle class="rim" r="21" />
			<path class="north" d="M0 -15 L5 0 L-5 0 Z" />
			<path class="south" d="M0 15 L5 0 L-5 0 Z" />
			{#if sun}<circle bind:this={sunMark} class="sun" cy="-21" r="3" />{/if}
		</g>
	</svg>
</button>

<style>
	.diorama-compass {
		position: absolute;
		margin: var(--diorama-compass-inset, 12px);
		padding: 0;
		width: var(--diorama-compass-size, 44px);
		height: var(--diorama-compass-size, 44px);
		border: 0;
		background: none;
		cursor: pointer;
	}
	.top-left {
		top: 0;
		left: 0;
	}
	.top-right {
		top: 0;
		right: 0;
	}
	.bottom-left {
		bottom: 0;
		left: 0;
	}
	.bottom-right {
		bottom: 0;
		right: 0;
	}
	svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.rim {
		fill: var(--diorama-compass-face, rgba(127, 127, 127, 0.14));
		stroke: var(--diorama-compass-color, #8a8f98);
		stroke-width: 1;
	}
	.north {
		fill: var(--diorama-compass-north, #e03131);
	}
	.south {
		fill: var(--diorama-compass-color, #8a8f98);
	}
	.sun {
		fill: var(--diorama-compass-sun, #f5b301);
	}
</style>
