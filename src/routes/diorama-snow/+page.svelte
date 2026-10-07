<!--
	A ski resort on a diorama: terrain fetched for the area the features cover, runs draped on
	the snow, and placeholder lifts, trees, buildings and labels from `@liquidx/diorama` on it.
-->
<script lang="ts">
	import type { Feature, Polygon } from 'geojson';
	import { asset, resolve } from '$app/paths';
	import {
		Building,
		Compass,
		Diorama,
		Drape,
		Label,
		Lift,
		Marker,
		Model,
		Trees,
		buildDiorama,
		shapesOf,
		type Circle,
		type DioramaData,
		type TerrainPreset
	} from '@liquidx/diorama';
	import DataCredits from '$lib/components/DataCredits.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { frameAt, frameBox } from '$lib/contour/mercator';
	import { PROVIDERS, sampleApiGrid } from '$lib/contour/terrain-api';
	import { CREDITS, type Credit } from '$lib/credits';
	import { gridSampler } from '$lib/diorama/sampler';

	let { data } = $props();

	const kind = (k: string) => (f: Feature) => f.properties?.kind === k;
	const isRun = kind('runSegment');
	const isLift = kind('lift');
	const isGondola = (f: Feature) => f.properties?.liftType === 'gondola';
	const find = (k: string) => data.features.features.find(kind(k));

	const DIFFICULTY: Record<string, string> = {
		easy: '#2f9e44',
		intermediate: '#d6336c',
		advanced: '#212529'
	};

	/** The smallest circle around the runs and lifts, with a little margin. */
	function fit(): Circle {
		const points = shapesOf(data.features)
			.filter((s) => isRun(s.feature) || isLift(s.feature))
			.flatMap((s) => s.coords.flat());
		const lons = points.map((p) => p[0]);
		const lats = points.map((p) => p[1]);
		const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
		const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
		const perLon = 111_320 * Math.cos((lat * Math.PI) / 180);
		const reach = Math.max(
			...points.map((p) => Math.hypot((p[0] - lon) * perLon, (p[1] - lat) * 111_320))
		);
		return { lon, lat, radius: reach * 1.12 };
	}

	/**
	 * Stand-in hotel footprints beside the base, as the features have no buildings: rectangles
	 * `[east, north, width, depth, height]` in metres from the base point.
	 */
	const hotels = $derived.by((): Feature<Polygon>[] => {
		const base = find('locationBase');
		if (base?.geometry.type !== 'Point') return [];
		const [lon, lat] = base.geometry.coordinates;
		const perLon = 111_320 * Math.cos((lat * Math.PI) / 180);
		return [
			[160, 60, 70, 26, 38],
			[250, 20, 26, 60, 52],
			[150, -30, 50, 22, 24]
		].map(([east, north, width, depth, height]) => {
			const corner = (dx: number, dy: number) => [
				lon + (east + dx * width) / perLon,
				lat + (north + dy * depth) / 111_320
			];
			return {
				type: 'Feature',
				properties: { height },
				geometry: {
					type: 'Polygon',
					coordinates: [[corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1), corner(0, 0)]]
				}
			};
		});
	});

	let terrain = $state<TerrainPreset>('snow');
	let exaggeration = $state(1.3);
	let objectScale = $state(4);
	let trees = $state<'none' | 'resort' | 'all'>('all');
	let showLabels = $state(true);
	let sunAzimuth = $state(231);
	let sunElevation = $state(48);
	let autoRotate = $state(true);
	let model = $state.raw<DioramaData | null>(null);
	let message = $state('');

	// Fetch elevation for the circle and build the mesh from it.
	const circle = fit();
	/** A square around the whole diorama, for tree cover beyond the ski area. */
	const everywhere = $derived.by((): Feature<Polygon> => {
		const dLat = (circle.radius * 1.05) / 111_320;
		const dLon = dLat / Math.cos((circle.lat * Math.PI) / 180);
		const corner = (x: number, y: number) => [circle.lon + x * dLon, circle.lat + y * dLat];
		return {
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [[corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)]]
			}
		};
	});

	async function build() {
		const frame = frameAt(circle.lon, circle.lat, circle.radius * 2);
		const box = frameBox({ ...frame, w: frame.w * 1.04 }, 1);
		const rings = 220;
		const { grid } = await sampleApiGrid(PROVIDERS[0], box, rings * 2 + 1, rings * 2 + 1);
		model = buildDiorama(gridSampler(grid, box), circle, { rings, segments: 512 });
	}
	build().catch((e) => (message = e instanceof Error ? e.message : String(e)));

	const credits: Credit[] = [
		CREDITS.awsTerrain,
		{
			name: 'openstreetmap',
			by: '© openstreetmap contributors, odbl · skimap.org',
			use: 'ski runs, lifts and resort area',
			url: 'https://www.openstreetmap.org/copyright'
		}
	];
</script>

<svelte:head><title>{data.tool.title} · Carto</title></svelte:head>

<section class="head">
	<h1>{data.tool.title}</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
	</div>
	<p>
		{data.features.metadata?.name ?? 'A ski resort'} on a
		<a href={resolve('/diorama')}>Mountain Diorama</a>: runs drawn on the terrain by difficulty,
		with placeholder lifts, trees, buildings and labels from <code>@liquidx/diorama</code>.
	</p>
</section>

<section class="body">
	<div class="stage">
		<Diorama
			data={model}
			{exaggeration}
			baseDepth={0.2}
			contourInterval={50}
			{terrain}
			{objectScale}
			sun={{ azimuth: sunAzimuth, elevation: sunElevation }}
			{autoRotate}
		>
			<Compass sun />
			<Drape
				data={data.features}
				filter={isRun}
				paint={(f) => ({ stroke: DIFFICULTY[f.properties?.difficulty] ?? '#868e96', width: 3 })}
			/>
			{#if trees !== 'none'}
				<Trees
					data={trees === 'all' ? everywhere : find('skiArea')}
					avoid={[...data.features.features.filter((f) => isRun(f) || isLift(f)), ...hotels]}
					clearance={30}
				/>
			{/if}
			<Lift
				data={data.features}
				filter={isLift}
				carrierSize={(f) => (isGondola(f) ? 3.4 : 2.2)}
				carrierColor={(f) => (isGondola(f) ? '#f08c00' : '#e03131')}
			/>
			<Building
				data={data.features}
				filter={kind('locationBase')}
				footprint={[60, 24]}
				height={14}
			/>
			<Building data={hotels} height={(f) => f.properties?.height} roofColor="#5c6670" />
			<Model
				src={asset('/diorama/summit-hut.glb')}
				data={data.features}
				filter={kind('locationPeak')}
				size={40}
				heading={200}
			/>
			<Marker data={data.features} filter={kind('locationPeak')} height={70} />
			{#if showLabels}
				<Label data={data.features} filter={isLift} text={(f) => f.properties?.nameEn} />
				<Label data={data.features} filter={kind('locationPeak')} altitude={95}>
					{#snippet children(f)}<strong>{f.properties?.maxElevation} m</strong>{/snippet}
				</Label>
			{/if}
		</Diorama>
		{#if !model && !message}<div class="hint">fetching terrain…</div>{/if}
	</div>
	{#if message}<div class="error">{message}</div>{/if}
	<div class="controls">
		<div class="control">
			<span class="label">style</span>
			<Segmented
				label="terrain style"
				options={[{ value: 'snow' }, { value: 'topo' }]}
				bind:value={terrain}
			/>
		</div>
		<div class="control">
			<span class="label">trees</span>
			<Segmented
				label="tree cover"
				options={[{ value: 'none' }, { value: 'resort' }, { value: 'all' }]}
				bind:value={trees}
			/>
		</div>
		<Slider
			label="object scale"
			min={1}
			max={8}
			step={0.5}
			bind:value={objectScale}
			format={(v) => `${v.toFixed(1)}×`}
		/>
		<Slider
			label="vertical exaggeration"
			min={0.5}
			max={3}
			step={0.1}
			bind:value={exaggeration}
			format={(v) => `${v.toFixed(1)}×`}
		/>
		<Slider
			label="sun bearing"
			min={0}
			max={359}
			step={1}
			bind:value={sunAzimuth}
			format={(v) => `${v}°`}
		/>
		<Slider
			label="sun height"
			min={5}
			max={90}
			step={1}
			bind:value={sunElevation}
			format={(v) => `${v}°`}
		/>
		<Toggle label="labels" bind:checked={showLabels} />
		<Toggle label="auto-rotate" bind:checked={autoRotate} />
	</div>
</section>

<DataCredits {credits} />

<style>
	.head {
		padding: 96px 0 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 18px;
	}
	h1 {
		font-size: var(--text-screen);
		font-weight: 600;
		letter-spacing: var(--tracking-title);
		text-transform: uppercase;
		line-height: 1.4;
	}
	.head .meta {
		display: flex;
		gap: 18px;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.head p {
		max-width: 560px;
		font-size: var(--text-content);
		color: var(--color-text-tertiary);
	}
	.head p a {
		color: inherit;
		text-decoration: underline;
	}
	.body {
		margin-top: 64px;
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.stage {
		position: relative;
		height: 640px;
		--diorama-background: var(--color-surface);
	}
	.hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--text-small);
		color: var(--color-text-faint);
		pointer-events: none;
	}
	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		align-items: end;
		gap: 32px 36px;
	}
	.control {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.control .label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.error {
		font-size: var(--text-small);
		color: var(--color-danger);
	}
	@media (max-width: 640px) {
		.stage {
			height: 420px;
		}
	}
</style>
