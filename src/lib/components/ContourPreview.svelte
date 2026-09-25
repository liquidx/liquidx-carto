<!--
	The rendered contour map as SVG. The element doubles as the export source, so what is
	previewed is exactly what is downloaded.
-->
<script lang="ts">
	import type { ContourPath } from '$lib/contour/worker';
	import type { ContourStyle } from '$lib/contour/styles';

	type Props = {
		paths: ContourPath[];
		style: ContourStyle;
		width: number;
		height: number;
		svg?: SVGSVGElement;
	};

	let { paths, style, width, height, svg = $bindable() }: Props = $props();

	const minor = $derived(paths.filter((p) => !p.major));
	const major = $derived(paths.filter((p) => p.major));
</script>

<svg
	bind:this={svg}
	xmlns="http://www.w3.org/2000/svg"
	{width}
	{height}
	viewBox="0 0 {width} {height}"
>
	<rect {width} {height} fill={style.background} />
	<g
		fill="none"
		stroke={style.ink}
		stroke-linejoin="round"
		stroke-linecap="round"
		stroke-width={style.minorWidth}
	>
		{#each minor as p (p.value)}
			<path d={p.d} data-elevation={p.value} />
		{/each}
	</g>
	<g
		fill="none"
		stroke={style.ink}
		stroke-linejoin="round"
		stroke-linecap="round"
		stroke-width={style.majorWidth}
	>
		{#each major as p (p.value)}
			<path d={p.d} data-elevation={p.value} />
		{/each}
	</g>
</svg>

<style>
	svg {
		display: block;
		max-width: 100%;
		height: auto;
	}
</style>
