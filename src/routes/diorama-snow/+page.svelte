<!--
	A ski resort on a diorama. The resort's runs, lifts, woods and terrain GLB are fetched from
	content.snowline.jp by location id (`?locationId=`, or the field below the title) and swapped
	in place when it changes; a location without a GLB has its terrain built from elevation tiles.
	Runs are draped on the snow, with placeholder lifts, trees, buildings and labels from
	`@liquidx/diorama` on it.
-->
<script lang="ts">
	import type { Feature, FeatureCollection, Polygon } from 'geojson';
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
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
		terrainStyles,
		type DioramaData,
		type TerrainPreset,
		type TerrainStyle
	} from '@liquidx/diorama';
	import DataCredits from '$lib/components/DataCredits.svelte';
	import PromptField from '$lib/components/PromptField.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { PROVIDERS } from '$lib/contour/terrain-api';
	import { CREDITS, type Credit } from '$lib/credits';
	import { circleBounds, fitCircle } from '$lib/diorama/fit';
	import {
		fetchLocation,
		isLocationId,
		type LocationData,
		type LocationFeatures
	} from '$lib/diorama/location';
	import { circleSampler } from '$lib/diorama/sampler';

	let { data } = $props();

	/** The location on show, or on its way: the id follows the URL and the field. */
	let locationId = $state(untrack(() => data.locationId));
	let draft = $state(untrack(() => data.locationId));
	let location = $state.raw<LocationData | null>(null);
	let loading = $state(false);
	let message = $state('');

	/** Each request is a new object, so submitting the same id again after a failure retries it. */
	let request = $state.raw({ id: untrack(() => data.locationId) });

	/** Switch locations: from the field, or from the URL changing under us. */
	function go(id: string) {
		id = id.trim();
		if (!id || (id === locationId && (loading || location))) return;
		if (!isLocationId(id)) {
			message = `"${id}" is not a location id: use letters, digits, - and _`;
			return;
		}
		locationId = id;
		request = { id };
	}
	// Back/forward, or a link to another location.
	$effect(() => {
		const fromUrl = data.locationId;
		untrack(() => {
			draft = fromUrl;
			go(fromUrl);
		});
	});

	// Fetch the features, woods and GLB whenever the id changes, dropping a fetch that is overtaken.
	$effect(() => {
		const { id } = request;
		const controller = new AbortController();
		loading = true;
		message = '';
		location = null;
		fetchLocation(id, { signal: controller.signal }).then(
			(next) => {
				if (controller.signal.aborted) return;
				location = next;
				loading = false;
				const url = new URL(window.location.href);
				if (url.searchParams.get('locationId') !== id) {
					url.searchParams.set('locationId', id);
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, query only
					replaceState(url, {});
				}
			},
			(e) => {
				if (controller.signal.aborted) return;
				loading = false;
				message = e instanceof Error ? e.message : String(e);
			}
		);
		return () => controller.abort();
	});

	const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
	const features = $derived<LocationFeatures>(location?.features ?? EMPTY);
	const woods = $derived<FeatureCollection>(location?.woods ?? EMPTY);
	const title = $derived(location?.features.metadata?.name ?? locationId);

	const kind = (k: string) => (f: Feature) => f.properties?.kind === k;
	const isRun = kind('runSegment');
	const isLift = kind('lift');
	const isGondola = (f: Feature) => f.properties?.liftType === 'gondola';
	const find = (k: string) => features.features.find(kind(k));
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

	/** Depth of the base below the lowest ground, as a fraction of the radius. */
	const BASE_DEPTH = 0.2;

	let terrain = $state<TerrainPreset>('snow');
	// Thickness of the snow (or topsoil) band on the cut sides, as a fraction of the radius.
	let topLayerDepth = $state(0.05);
	const style = $derived<TerrainStyle>({
		...terrainStyles[terrain],
		sides: { ...terrainStyles[terrain].sides, topLayerDepth }
	});
	let exaggeration = $state(1);
	let objectScale = $state(1);
	let liftsMoving = $state(true);
	let riders = $state(true);
	let trees = $state<'none' | 'woods' | 'all'>('woods');
	let showLabels = $state(true);
	let sunAzimuth = $state(231);
	let sunElevation = $state(48);
	let background = $state('#24344d');
	let backgroundGradient = $state(0.5);
	let autoRotate = $state(true);

	// The circle around the runs and lifts, which `pnpm diorama-woods` fits its woods to.
	const circle = $derived.by(() => {
		const points = shapesOf(features)
			.filter((s) => isRun(s.feature) || isLift(s.feature))
			.flatMap((s) => s.coords.flat());
		return points.length ? fitCircle(points) : null;
	});
	/** A square around the whole diorama, for tree cover everywhere. */
	const everywhere = $derived.by((): Feature<Polygon> | null => {
		if (!circle) return null;
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

	/**
	 * The terrain: the location's GLB, or when it has none, a mesh built from elevation tiles
	 * over the circle. Exactly one of the two is set while a location is on show.
	 */
	let glb = $state.raw<ArrayBuffer | null>(null);
	/** Whether the stage has finished with `glb`. */
	let glbLoaded = $state(false);
	let model = $state.raw<DioramaData | null>(null);
	let building = $state(false);
	$effect(() => {
		const current = location;
		const c = circle;
		glb = null;
		glbLoaded = false;
		model = null;
		building = false;
		if (!current) return;
		if (current.glb) {
			glb = current.glb;
			return;
		}
		if (!c) {
			message = 'The features have no runs or lifts to fit the terrain to.';
			return;
		}
		// Fetch elevation for the circle and build the mesh from it.
		const controller = new AbortController();
		const rings = 220;
		building = true;
		circleSampler(PROVIDERS[0], c, rings, controller.signal).then(
			({ sample }) => {
				if (controller.signal.aborted) return;
				model = buildDiorama(sample, c, { rings });
				building = false;
			},
			(e) => {
				if (controller.signal.aborted) return;
				building = false;
				message = e instanceof Error ? e.message : String(e);
			}
		);
		return () => controller.abort();
	});
	const hint = $derived(
		loading
			? 'fetching location…'
			: building
				? 'fetching terrain…'
				: glb && !glbLoaded
					? 'loading terrain…'
					: ''
	);

	const credits: Credit[] = [
		CREDITS.awsTerrain,
		{
			name: 'openskidata',
			by: 'openskidata.org · © openstreetmap contributors, odbl',
			use: 'ski runs, lifts and woodland',
			url: 'https://openskidata.org/'
		}
	];
</script>

<svelte:head><title>{data.tool.title} · {title} · Carto</title></svelte:head>

<section class="head">
	<h1>{data.tool.title}</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
		{#if location}<span>{title}</span>{/if}
	</div>
	<p>
		A variation of the <a href={resolve('/diorama')}>Mountain Diorama</a> but with animated objects
		like ski lifts and snowboards along with a layer of trees placed in areas defined by a GeoJSON
		file. Zoom in to find them. The runs, woods and terrain are fetched by location id from
		<code>content.snowline.jp/terrain</code>; type another id to switch.
	</p>
	<div class="location">
		<PromptField
			bind:value={draft}
			placeholder="location id"
			hint="⏎ load"
			aria-label="location id"
			onsubmit={go}
		/>
		{#if location?.missing.length}
			<div class="note">
				no {location.missing.map((m) => (m === 'glb' ? 'terrain glb' : m)).join(' or ')} for
				{locationId}{#if location.missing.includes('glb')}: terrain built from elevation tiles{/if}
			</div>
		{/if}
	</div>
</section>

<section class="body">
	<div class="stage">
		<Diorama
			src={glb}
			data={model}
			{exaggeration}
			baseDepth={BASE_DEPTH}
			contourInterval={50}
			terrain={style}
			{objectScale}
			sun={{ azimuth: sunAzimuth, elevation: sunElevation }}
			{background}
			{backgroundGradient}
			bind:autoRotate
			rotateButton
			minDistance={0.1}
			onload={() => (glbLoaded = true)}
			onerror={(e) => (message = e instanceof Error ? e.message : String(e))}
		>
			<Compass sun />
			<Drape
				data={features}
				filter={isRun}
				paint={(f) => ({ stroke: DIFFICULTY[f.properties?.difficulty] ?? '#868e96', width: 3 })}
			/>
			{#if riders}
				<Riders data={features} filter={isRun} every={90} speed={ridingSpeed} />
			{/if}
			{#if trees !== 'none'}
				<Trees
					data={trees === 'all' ? (everywhere ?? woods) : woods}
					avoid={[...features.features.filter((f) => isRun(f) || isLift(f)), ...hotels]}
					clearance={30}
					density={6000}
					height={16}
					limit={120_000}
				/>
			{/if}
			<Lift
				data={features}
				filter={isLift}
				height={(f) => (isGondola(f) ? 14 : 9)}
				carrier={(f) => (isGondola(f) ? 'cabin' : 'chair')}
				carrierEvery={(f) => (isGondola(f) ? 45 : seats(f) >= 4 ? 28 : 14)}
				carrierSize={(f) => (isGondola(f) ? 2 : seats(f) * 0.55 + 0.2)}
				speed={(f) => (liftsMoving ? liftSpeed(f) : 0)}
				carrierColor={(f) => (isGondola(f) ? '#f08c00' : '#e03131')}
			/>
			<Building data={features} filter={kind('locationBase')} footprint={[60, 24]} height={14} />
			<Building data={hotels} height={(f) => f.properties?.height} roofColor="#5c6670" />
			<Model
				src={asset('/diorama/summit-hut.glb')}
				data={features}
				filter={kind('locationPeak')}
				size={25}
				heading={200}
			/>
			<Marker data={features} filter={kind('locationPeak')} height={70} />
			{#if showLabels}
				<Label data={features} filter={isLift} text={(f) => f.properties?.nameEn} />
				<Label data={features} filter={kind('locationPeak')} altitude={95}>
					{#snippet children(f)}<strong>{f.properties?.maxElevation} m</strong>{/snippet}
				</Label>
			{/if}
		</Diorama>
		{#if hint && !message}<div class="hint">{hint}</div>{/if}
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
			label={terrain === 'snow' ? 'snow depth' : 'topsoil depth'}
			min={0}
			max={BASE_DEPTH}
			step={0.005}
			bind:value={topLayerDepth}
			format={(v) => v.toFixed(3)}
		/>
		<Slider
			label="object scale"
			min={1}
			max={8}
			step={0.5}
			bind:value={objectScale}
			format={(v) => `${v.toFixed(1)}×`}
		/>
		{#if !glb}
			<!-- A GLB keeps the relief it was exported with. -->
			<Slider
				label="vertical exaggeration"
				min={0.5}
				max={3}
				step={0.1}
				bind:value={exaggeration}
				format={(v) => `${v.toFixed(1)}×`}
			/>
		{/if}
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
	.head p code {
		font-size: inherit;
	}
	.location {
		width: 100%;
		max-width: 360px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.note {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
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
