<!--
	A ski resort's runs draped on the snow in the colour of their difficulty: a run mapped as a
	line is drawn as one, and a run mapped as an area is washed with its colour. The colours
	pale as the view closes in, where a run is wide on screen and would weigh on the snow.
	Reads features as `ski.ts` describes.
-->
<script lang="ts">
	import type { Feature } from 'geojson';
	import { getDiorama } from '../context.js';
	import Drape from '../Drape.svelte';
	import type { GeoJSONSource } from '../geojson.svelte.js';
	import { difficultyOf, isArea, isRun, paler, RUN_COLORS, type Difficulty } from '../ski.js';

	type Props = {
		/** Runs, among anything else: GeoJSON in any form, or a URL. */
		data?: GeoJSONSource;
		/** Which features are runs. Defaults to those of `kind: 'runSegment'`. */
		filter?: (feature: Feature) => boolean;
		/** Colours by difficulty, as #rrggbb; those left out keep the defaults. */
		colors?: Partial<Record<Difficulty, string>>;
		/** Width of a run drawn as a line, in pixels of the diorama 1024 across. */
		width?: number;
		/** How opaque a run mapped as an area is. */
		areaOpacity?: number;
		/** Width of the outline of a run mapped as an area, in its own colour; 0 for none. */
		areaOutline?: number;
		/**
		 * How far towards white the runs are drawn, 0 to 1. Without it they follow the zoom: their
		 * own colour from afar, paling to half way as the view closes in.
		 */
		paleness?: number;
		/** Draw over the contour lines instead of under them. */
		above?: boolean;
	};

	let {
		data,
		filter = isRun,
		colors,
		width = 3,
		areaOpacity = 0.65,
		areaOutline = 0.5,
		paleness,
		above = false
	}: Props = $props();

	const diorama = getDiorama();

	// In steps, so that the runs are not drawn again on every frame of a zoom.
	const pale = $derived.by(() => {
		if (paleness !== undefined) return paleness;
		const near = Math.min(1, Math.max(0, (1.5 - diorama.distance) / 1.2));
		return Math.round(near * 5) / 10;
	});

	function paint(f: Feature) {
		const colour = (alpha?: number) =>
			paler(colors?.[difficultyOf(f)] ?? RUN_COLORS[difficultyOf(f)], pale, alpha);
		if (!isArea(f)) return { stroke: colour(), width };
		return areaOutline > 0
			? { fill: colour(areaOpacity), stroke: colour(), width: areaOutline }
			: { fill: colour(areaOpacity) };
	}
</script>

<Drape {data} {filter} {paint} {above} />
