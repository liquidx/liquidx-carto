<!--
	The game's map: the resort as a Snow Diorama (`@liquidx/diorama`), with the runs draped
	by difficulty, the lifts standing on it, and an arrow for the rider. Drag to orbit, click
	to teleport. Terrain comes from the same tile providers as the game.
-->
<script lang="ts">
	import type { Feature, FeatureCollection } from 'geojson';
	import {
		Diorama,
		Drape,
		Label,
		Lift,
		Trees,
		buildDiorama,
		type DioramaData
	} from '@liquidx/diorama';
	import { xToLon, yToLat, frameAt, frameBox } from '$lib/contour/mercator';
	import { findProvider, sampleApiGrid } from '$lib/contour/terrain-api';
	import { gridSampler } from '$lib/diorama/sampler';
	import type { Game } from './game';
	import MinimapPick from './MinimapPick.svelte';
	import MinimapRider from './MinimapRider.svelte';
	import MinimapView from './MinimapView.svelte';
	import { DIFFICULTY_COLOR, type Difficulty, type FeaturesFile } from './resort';

	type Props = {
		game: Game;
		features: FeaturesFile;
		/** Wood and forest polygons to stand trees on, if known. */
		woods?: FeatureCollection | null;
		/** Terrain provider id for the model; coarse tiles are fine for a map this size. */
		provider?: string;
		showLabels?: boolean;
		onteleport: (lon: number, lat: number) => void;
	};
	let {
		game,
		features,
		woods = null,
		provider = 'gsi',
		showLabels = true,
		onteleport
	}: Props = $props();
	const inTheWay = $derived(features.features.filter((f) => isRun(f) || isLift(f)));

	const kind = (k: string) => (f: Feature) => f.properties?.kind === k;
	const isRun = kind('runSegment');
	const isLift = kind('lift');

	let model = $state.raw<DioramaData | null>(null);
	let message = $state('');

	// The smallest circle round the runs and lifts, in the game's own frame, then on the globe.
	function fit() {
		const points = [...game.resort.runs, ...game.resort.lifts].flatMap((f) => f.path);
		const xs = points.map((p) => p[0]);
		const zs = points.map((p) => p[1]);
		const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
		const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
		const radius = Math.max(...points.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) * 1.1;
		const [mx, my] = game.frame.worldToMercator(cx, cz);
		return { lon: xToLon(mx), lat: yToLat(my), radius };
	}

	$effect(() => {
		let cancelled = false;
		const circle = fit();
		const frame = frameAt(circle.lon, circle.lat, circle.radius * 2);
		const box = frameBox({ ...frame, w: frame.w * 1.04 }, 1);
		const rings = 140;
		sampleApiGrid(findProvider(provider), box, rings * 2 + 1, rings * 2 + 1)
			.then(({ grid }) => {
				if (cancelled) return;
				model = buildDiorama(gridSampler(grid, box), circle, { rings });
			})
			.catch((e) => (message = e instanceof Error ? e.message : String(e)));
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="minimap" title="drag to look round · click to teleport">
	{#if message}
		<span class="error">{message}</span>
	{:else}
		<Diorama
			data={model}
			terrain="snow"
			exaggeration={1.3}
			baseDepth={0.12}
			contourInterval={100}
			objectScale={5}
			autoRotate={false}
			minDistance={0.6}
		>
			<Drape
				data={features}
				filter={isRun}
				paint={(f) => ({
					stroke: DIFFICULTY_COLOR[f.properties?.difficulty as Difficulty] ?? '#868e96',
					width: 3
				})}
			/>
			{#if woods}
				<Trees
					data={woods}
					avoid={inTheWay}
					clearance={30}
					density={2500}
					height={16}
					limit={40_000}
				/>
			{/if}
			<Lift data={features} filter={isLift} carrierEvery={0} />
			{#if showLabels}
				<Label data={features} filter={isLift} text={(f) => f.properties?.nameEn} />
			{/if}
			<MinimapView />
			<MinimapRider {game} />
			<MinimapPick onpick={onteleport} />
		</Diorama>
	{/if}
</div>

<style>
	.minimap {
		width: 100%;
		height: 100%;
		--diorama-background: transparent;
		--diorama-label-size: 9px;
		--diorama-label-color: #e6e6ea;
		--diorama-label-halo: #08080a;
	}
	.error {
		font-size: var(--text-meta);
		color: var(--color-danger);
	}
</style>
