<!--
	The view from where you stand: a WebGL canvas drawn by `FujiScene`, with the sun's paths
	drawn over it where they really fall in the frame. Drag to look around.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type * as THREE from 'three';
	import type { Observer, TerrainGrid } from './alignment';
	import { FujiScene, type Conditions, type SunState } from './scene';
	import { SUN_RADIUS, fmtTime, jstParts } from './sun';

	export type PathPoint = { azimuth: number; altitude: number; time: number };
	/** The sun's path across the sky on one day; `strong` is the day chosen. */
	export type SunPath = { label: string; strong: boolean; points: PathPoint[] };

	type Props = {
		grids: TerrainGrid[] | null;
		observer: Observer;
		sun: SunState;
		/** Where the lens looks; dragging the view changes them. */
		bearing: number;
		pitch: number;
		conditions: Conditions;
		/** The summit's bearing and apparent elevation, marked in the frame. */
		summit: { bearing: number; angle: number };
		paths?: SunPath[];
		/** Building meshes in the scene's frame, about the observer. */
		buildings?: THREE.BufferGeometry[];
		/** Keep redrawing so the clouds drift. */
		animate?: boolean;
	};

	let {
		grids,
		observer,
		sun,
		bearing = $bindable(),
		pitch = $bindable(),
		conditions,
		summit,
		paths = [],
		buildings = [],
		animate = false
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let scene: FujiScene | null = $state.raw(null);
	let size = $state({ width: 0, height: 0 });
	let frame = 0;

	type Pt = { x: number; y: number };
	type Drawn = {
		paths: {
			label: string;
			strong: boolean;
			d: string;
			top: Pt | null;
			ticks: (Pt & { t: string })[];
		}[];
		sun: Pt | null;
		summit: Pt | null;
		compass: { x: number; label: string }[];
		radius: number;
	};
	let drawn = $state.raw<Drawn | null>(null);

	onMount(() => {
		const s = new FujiScene(canvas);
		scene = s;
		if (import.meta.env.DEV) (window as unknown as { __fuji: FujiScene }).__fuji = s;
		const ro = new ResizeObserver(() => {
			const r = canvas.getBoundingClientRect();
			size = { width: r.width, height: r.height };
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

	const hfov = $derived(2 * Math.atan(18 / conditions.focalLength) * (180 / Math.PI));

	function draw() {
		if (!scene || !grids) return;
		scene.render(sun, bearing, pitch, conditions);
		overlay(scene);
	}

	/** Project everything drawn over the frame through the camera that just drew it. */
	function overlay(s: FujiScene) {
		const { width: w, height: h } = size;
		if (!w || !h) return;
		const at = (az: number, alt: number) => s.project(az, alt, w, h);
		const inside = (p: Pt | null): p is Pt =>
			!!p && p.x > -50 && p.x < w + 50 && p.y > -50 && p.y < h + 50;
		const out: Drawn = {
			paths: [],
			sun: at(sun.azimuth, sun.altitude),
			summit: at(summit.bearing, summit.angle),
			compass: [],
			radius: (SUN_RADIUS / hfov) * w
		};
		for (const path of paths) {
			let d = '';
			let top: Pt | null = null;
			const ticks: (Pt & { t: string })[] = [];
			let pen = false;
			for (const m of path.points) {
				const p = at(m.azimuth, m.altitude);
				if (!inside(p)) {
					pen = false;
					continue;
				}
				d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
				pen = true;
				if (!top || p.y < top.y) top = p;
				const minute = jstParts(m.time).minute;
				if (path.strong && minute % 10 === 0)
					ticks.push({ ...p, t: minute % 30 === 0 ? fmtTime(m.time) : '' });
			}
			out.paths.push({ label: path.label, strong: path.strong, d, top, ticks });
		}
		// Bearings along the bottom, at a spacing that suits the lens.
		const step = hfov > 40 ? 10 : hfov > 12 ? 5 : 1;
		for (
			let a = Math.ceil((bearing - hfov / 2) / step) * step;
			a <= bearing + hfov / 2;
			a += step
		) {
			const p = at(a, pitch);
			if (p) out.compass.push({ x: p.x, label: `${((a % 360) + 360) % 360}°` });
		}
		drawn = out;
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
		void [sun, bearing, pitch, conditions, paths, summit];
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

	// ── look around ──────────────────────────────────────
	let dragging: { x: number; y: number; bearing: number; pitch: number } | null = null;
	function down(e: PointerEvent) {
		dragging = { x: e.clientX, y: e.clientY, bearing, pitch };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!dragging || !size.width) return;
		// The ground follows the pointer: a pixel is the lens's angle across the frame, over its width.
		const k = hfov / size.width;
		bearing = (dragging.bearing - (e.clientX - dragging.x) * k + 360) % 360;
		pitch = Math.max(-10, Math.min(60, dragging.pitch + (e.clientY - dragging.y) * k));
	}
	function up() {
		dragging = null;
	}
</script>

<div
	class="view"
	role="application"
	aria-label="the view from where you stand; drag to look around"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
>
	<canvas bind:this={canvas} class:loading={!grids}></canvas>
	{#if drawn && grids}
		<svg class="overlay" viewBox="0 0 {size.width} {size.height}" aria-hidden="true">
			{#each drawn.paths.filter((p) => !p.strong) as p (p.label)}
				<path d={p.d} class="path" />
				{#if p.top}
					<text x={p.top.x} y={p.top.y - 6} class="path-label">{p.label}</text>
				{/if}
			{/each}
			{#each drawn.paths.filter((p) => p.strong) as p (p.label)}
				<path d={p.d} class="path strong" />
				{#each p.ticks as t, i (i)}
					<circle cx={t.x} cy={t.y} r="2.5" class="tick" />
					{#if t.t}<text x={t.x + 8} y={t.y + 3} class="tick-label">{t.t}</text>{/if}
				{/each}
			{/each}
			{#if drawn.summit}
				<line
					x1={drawn.summit.x}
					x2={drawn.summit.x}
					y1={drawn.summit.y - 26}
					y2={drawn.summit.y - 8}
					class="summit"
				/>
				<text x={drawn.summit.x} y={drawn.summit.y - 32} class="summit-label">summit</text>
			{/if}
			{#if drawn.sun}
				<circle
					cx={drawn.sun.x}
					cy={drawn.sun.y}
					r={Math.max(drawn.radius, 5)}
					class="sun"
					class:small={drawn.radius < 5}
				/>
			{/if}
			{#each drawn.compass as c (c.label)}
				<line x1={c.x} x2={c.x} y1={size.height - 8} y2={size.height} class="compass" />
				<text x={c.x} y={size.height - 14} class="compass-label">{c.label}</text>
			{/each}
		</svg>
	{/if}
</div>

<style>
	.view {
		position: relative;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.view:active {
		cursor: grabbing;
	}
	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--color-map-ink);
	}
	.loading {
		opacity: 0.4;
	}
	.overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		font-family: var(--font-mono);
		overflow: hidden;
	}
	.path {
		fill: none;
		stroke: #ffffff;
		stroke-opacity: 0.35;
		stroke-width: 1;
	}
	.path.strong {
		stroke: var(--color-warn);
		stroke-opacity: 1;
		stroke-width: 1.5;
	}
	.path-label {
		font-size: 10px;
		fill: #ffffff;
		fill-opacity: 0.7;
		text-anchor: middle;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.45);
		stroke-width: 3px;
	}
	.tick {
		fill: var(--color-warn);
	}
	.tick-label {
		font-size: 10px;
		fill: #ffffff;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.5);
		stroke-width: 3px;
	}
	.sun {
		fill: none;
		stroke: var(--color-warn);
		stroke-width: 2;
	}
	.sun.small {
		fill: var(--color-warn);
	}
	.summit {
		stroke: #ffffff;
		stroke-width: 1;
	}
	.summit-label,
	.compass-label {
		font-size: 10px;
		fill: #ffffff;
		text-anchor: middle;
		letter-spacing: 0.04em;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.5);
		stroke-width: 3px;
	}
	.compass {
		stroke: #ffffff;
		stroke-opacity: 0.6;
	}
	.compass-label {
		fill-opacity: 0.75;
	}
</style>
