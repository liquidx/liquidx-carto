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
		Riders,
		Trees,
		buildDiorama,
		shapesOf,
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
	import { circleBounds, fitCircle } from '$lib/diorama/fit';
	import { gridSampler } from '$lib/diorama/sampler';

	let { data } = $props();

	const kind = (k: string) => (f: Feature) => f.properties?.kind === k;
	const isRun = kind('runSegment');
	const isLift = kind('lift');
	const isGondola = (f: Feature) => f.properties?.liftType === 'gondola';
	const find = (k: string) => data.features.features.find(kind(k));
	const seats = (f: Feature): number => f.properties?.occupancy ?? 2;
	/** Metres a second: from the ride time where the lift has one, else typical for its kind. */
	function liftSpeed(f: Feature) {
		const { lengthMeters, durationSecs } = f.properties ?? {};
		if (lengthMeters && durationSecs) return lengthMeters / durationSecs;
		return isGondola(f) ? 5 : seats(f) >= 4 ? 4 : 2;
	}

	const DIFFICULTY: Record<string, string> = {
		easy: '#2f9e44',
		intermediate: '#d6336c',
		advanced: '#212529'
	};
	/** Average snowboarding speed by run, in metres a second: a cruise on the greens, faster on the blacks. */
	const RIDING_SPEED: Record<string, number> = { easy: 8, intermediate: 11, advanced: 14 };
	const ridingSpeed = (f: Feature) => RIDING_SPEED[f.properties?.difficulty] ?? 10;

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
	let exaggeration = $state(1);
	let objectScale = $state(1);
	let liftsMoving = $state(true);
	let riders = $state(false);
	let trees = $state<'none' | 'woods' | 'all'>('woods');
	let showLabels = $state(true);
	let sunAzimuth = $state(231);
	let sunElevation = $state(48);
	let background = $state('#24344d');
	let backgroundGradient = $state(0.5);
	let autoRotate = $state(true);
	let model = $state.raw<DioramaData | null>(null);
	let message = $state('');

	// The circle around the runs and lifts, which `pnpm diorama-woods` fits its woods to.
	const circle = fitCircle(
		shapesOf(data.features)
			.filter((s) => isRun(s.feature) || isLift(s.feature))
			.flatMap((s) => s.coords.flat())
	);
	/** A square around the whole diorama, for tree cover everywhere. */
	const everywhere = $derived.by((): Feature<Polygon> => {
		const [west, south, east, north] = circleBounds(circle);
		return {
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[west, south],
						[east, south],
						[east, north],
						[west, north],
						[west, south]
					]
				]
			}
		};
	});

	// Fetch elevation for the circle and build the mesh from it.
	async function build() {
		const frame = frameAt(circle.lon, circle.lat, circle.radius * 2);
		const box = frameBox({ ...frame, w: frame.w * 1.04 }, 1);
		const rings = 220;
		const { grid } = await sampleApiGrid(PROVIDERS[0], box, rings * 2 + 1, rings * 2 + 1);
		model = buildDiorama(gridSampler(grid, box), circle, { rings });
	}
	build().catch((e) => (message = e instanceof Error ? e.message : String(e)));

	const credits: Credit[] = [
		CREDITS.awsTerrain,
		{
			name: 'openstreetmap',
			by: '© openstreetmap contributors, odbl · skimap.org',
			use: 'ski runs, lifts and woodland',
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
		with placeholder lifts, trees and buildings from <code>@liquidx/diorama</code> at their true size,
		and snowboarders riding the runs at a real-world pace. Zoom in to find them.
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
			{background}
			{backgroundGradient}
			{autoRotate}
			minDistance={0.1}
		>
			<Compass sun />
			<Drape
				data={data.features}
				filter={isRun}
				paint={(f) => ({ stroke: DIFFICULTY[f.properties?.difficulty] ?? '#868e96', width: 3 })}
			/>
			{#if riders}
				<Riders data={data.features} filter={isRun} every={90} speed={ridingSpeed} />
			{/if}
			{#if trees !== 'none'}
				<Trees
					data={trees === 'all' ? everywhere : data.woods}
					avoid={[...data.features.features.filter((f) => isRun(f) || isLift(f)), ...hotels]}
					clearance={30}
					density={6000}
					height={16}
					limit={120_000}
				/>
			{/if}
			<Lift
				data={data.features}
				filter={isLift}
				height={(f) => (isGondola(f) ? 14 : 9)}
				carrier={(f) => (isGondola(f) ? 'cabin' : 'chair')}
				carrierEvery={(f) => (isGondola(f) ? 45 : seats(f) >= 4 ? 28 : 14)}
				carrierSize={(f) => (isGondola(f) ? 2 : seats(f) * 0.55 + 0.2)}
				speed={(f) => (liftsMoving ? liftSpeed(f) : 0)}
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
				size={25}
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
				options={[{ value: 'none' }, { value: 'woods' }, { value: 'all' }]}
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
		<label class="control">
			<span class="label">background</span>
			<input class="swatch" type="color" bind:value={background} />
		</label>
		<Slider
			label="background gradient"
			min={0}
			max={1}
			step={0.05}
			bind:value={backgroundGradient}
			format={(v) => v.toFixed(2)}
		/>
		<Toggle label="moving lifts" bind:checked={liftsMoving} />
		<Toggle label="snowboarders" bind:checked={riders} />
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
	.swatch {
		width: 100%;
		height: 20px;
		padding: 0;
		border: 1px solid var(--color-line-control);
		background: none;
		cursor: pointer;
	}
	.swatch::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	.swatch::-webkit-color-swatch {
		border: 0;
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
