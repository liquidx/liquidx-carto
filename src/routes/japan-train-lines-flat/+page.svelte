<script lang="ts">
	import JapanTrainLines from '$lib/train-lines/JapanTrainLines.svelte';
	import MapCredits from '$lib/components/MapCredits.svelte';
	import { TRAIN_LINES_CREDITS } from '$lib/credits';
	import { DATA_URLS } from '$lib/train-lines/data';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.tool.title} · Carto</title>
	<meta name="description" content={data.tool.summary} />
</svelte:head>

<JapanTrainLines
	railroadGeoJsonUrl={DATA_URLS.railroad}
	stationGeoJsonUrl={DATA_URLS.stations}
	japanOutlineGeoJsonUrl={DATA_URLS.japanOutline}
	lineRegionIndexUrl={DATA_URLS.lineRegionIndex}
	prefecturePolygonsUrl={DATA_URLS.prefecturePolygons}
/>
<MapCredits credits={TRAIN_LINES_CREDITS} />
