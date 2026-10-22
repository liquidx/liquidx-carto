<script lang="ts">
	import { onMount } from 'svelte';
	import TrainMap3D from '$lib/train-lines/3d/TrainMap3D.svelte';
	import MapCredits from '$lib/components/MapCredits.svelte';
	import { CREDITS } from '$lib/credits';
	import { DATA_URLS } from '$lib/train-lines/data';

	let { data } = $props();

	let railroadGeoJson = $state(null);
	let stationGeoJson = $state(null);
	let lineRegionIndex = $state(null);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			const [rail, stations, index] = await Promise.all([
				fetch(DATA_URLS.railroad).then((r) => r.json()),
				fetch(DATA_URLS.stations).then((r) => r.json()),
				fetch(DATA_URLS.lineRegionIndex).then((r) => r.json())
			]);
			railroadGeoJson = rail;
			stationGeoJson = stations;
			lineRegionIndex = index;
		} catch (e) {
			error = String(e);
		}
	});
</script>

<svelte:head>
	<title>{data.tool.title} · Carto</title>
	<meta name="description" content={data.tool.summary} />
</svelte:head>

{#if error}
	<div class="loading">failed to load data: {error}</div>
{:else if railroadGeoJson && stationGeoJson && lineRegionIndex}
	<TrainMap3D {railroadGeoJson} {stationGeoJson} {lineRegionIndex} />
{:else}
	<div class="loading">loading railway data…</div>
{/if}
<MapCredits credits={[CREDITS.ksjRail, CREDITS.prefectures]} />

<style>
	.loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--text-small);
		letter-spacing: var(--tracking-label);
		color: var(--color-text-label);
	}
</style>
