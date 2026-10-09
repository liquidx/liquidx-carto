<!--
	A ski resort on a diorama. The resort's runs and lifts, its scene (woods, water, buildings,
	roads and car parks from OpenStreetMap) and its terrain GLB are fetched from snowline by
	location id (`?locationId=`, or the field below the title) and swapped in place when it
	changes; without an id, the default location comes from the app's own `static/diorama`
	files. A location without a GLB has its terrain built from elevation tiles. Runs, roads
	and water are draped on the snow, with lifts, trees, buildings and labels from
	`@liquidx/diorama` standing on it.
-->
<script lang="ts">
	import type { Feature, FeatureCollection, Polygon } from 'geojson';
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { asset, resolve } from '$app/paths';
	import {
		Building,
		Carpet,
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

	/**
	 * Each request is a new object, so submitting the same id again after a failure retries it.
	 * `local` reads the app's own files instead of snowline: only for the default location,
	 * when the URL names none.
	 */
	let request = $state.raw(untrack(() => ({ id: data.locationId, local: data.local })));
	const local = $derived(location !== null && request.local);

	/** Switch locations: from the field, or from the URL changing under us. */
	function go(id: string, local = false) {
		id = id.trim();
		if (!id || (id === locationId && local === request.local && (loading || location))) return;
		if (!isLocationId(id)) {
			message = `"${id}" is not a location id: use letters, digits, - and _`;
			return;
		}
		locationId = id;
		request = { id, local };
	}
	// Back/forward, or a link to another location.
	$effect(() => {
		const { locationId: fromUrl, local } = data;
		untrack(() => {
			draft = fromUrl;
			go(fromUrl, local);
		});
	});

	// Fetch the features, scene and GLB whenever the id changes, dropping a fetch that is overtaken.
	$effect(() => {
		const { id, local } = request;
		const controller = new AbortController();
		loading = true;
		message = '';
		location = null;
		fetchLocation(id, {
			signal: controller.signal,
			...(local ? { base: asset('/diorama/') } : {})
		}).then(
			(next) => {
				if (controller.signal.aborted) return;
				location = next;
				loading = false;
				const url = new URL(window.location.href);
				// A URL without an id means the local files; it only gets one once snowline is read.
				if (!local && url.searchParams.get('locationId') !== id) {
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
	const scene = $derived<FeatureCollection>(location?.scene ?? EMPTY);
	const title = $derived(location?.features.metadata?.name ?? locationId);

	const kind = (k: string) => (f: Feature) => f.properties?.kind === k;
	const isRun = kind('runSegment');
	const isLift = kind('lift');
	// The scene, by what `pnpm diorama-scene` found.
	const isWood = kind('wood');
	const isWater = kind('water');
	const isWaterway = kind('waterway');
	const isBuilding = kind('building');
	const isRoad = kind('road');
	const isCarpark = kind('carpark');
	const woods = $derived<FeatureCollection>({
		type: 'FeatureCollection',
		features: scene.features.filter(isWood)
	});
	const isGondola = (f: Feature) => f.properties?.liftType === 'gondola';
	/** An aerial tramway: two big cabins that shuttle up and down, one on each side. */
	const isCableCar = (f: Feature) => f.properties?.liftType === 'cable_car';
	const isCabin = (f: Feature) => isGondola(f) || isCableCar(f);
	/** A rope at arm's height with balls to hold on to, and no stations. */
	const isRopeTow = (f: Feature) => f.properties?.liftType === 'rope_tow';
	/** A magic carpet is a belt on the snow, not a cable in the air. */
	const isCarpet = (f: Feature) => f.properties?.liftType === 'magic_carpet';
	const isAerial = (f: Feature) => isLift(f) && !isCarpet(f);
	const isMagicCarpet = (f: Feature) => isLift(f) && isCarpet(f);
	const seats = (f: Feature): number => f.properties?.occupancy ?? 2;
	/** Width of a carrier in metres: a seat's worth each for a chair, a cabin by how many it holds. */
	function carrierWidth(f: Feature) {
		const n = seats(f);
		if (isCableCar(f)) return 2.8;
		if (isRopeTow(f)) return 0.3;
		if (!isGondola(f)) return n * 0.55 + 0.2;
		return n >= 8 ? 2.4 : n >= 6 ? 2.1 : 1.8;
	}
	/** Metres a second: from the ride time where the lift has one, else typical for its kind. */
	function liftSpeed(f: Feature) {
		const { lengthMeters, durationSecs } = f.properties ?? {};
		if (lengthMeters && durationSecs) return lengthMeters / durationSecs;
		if (isCarpet(f)) return 0.7;
		return isCableCar(f) ? 8 : isGondola(f) ? 5 : seats(f) >= 4 && !isRopeTow(f) ? 4 : 2;
	}

	const DIFFICULTY: Record<string, string> = {
		easy: '#2f9e44',
		intermediate: '#d6336c',
		advanced: '#212529'
	};
	/** Average snowboarding speed by run, in metres a second: a cruise on the greens, faster on the blacks. */
	const RIDING_SPEED: Record<string, number> = { easy: 8, intermediate: 11, advanced: 14 };
	const ridingSpeed = (f: Feature) => RIDING_SPEED[f.properties?.difficulty] ?? 10;

	/** Metres a storey, for buildings that only have a storey count. */
	const STOREY = 3.2;
	/** Wall heights in metres by building type, for the many with neither height nor storeys. */
	const BUILDING_HEIGHT: Record<string, number> = { hotel: 16, commercial: 8, retail: 6 };
	function buildingHeight(f: Feature) {
		const { height, levels, buildingType } = f.properties ?? {};
		return height ?? (levels ? levels * STOREY : (BUILDING_HEIGHT[buildingType] ?? 6));
	}

	/** Water on the snow is a hazard off the runs: an icy pale blue, unlike anything else on it. */
	const WATER = { fill: '#d0ebff', stroke: '#8fcbf2' };
	function waterPaint(f: Feature) {
		const { kind, waterType, intermittent } = f.properties ?? {};
		const dash = intermittent ? [6, 4] : undefined;
		if (kind === 'water') return { fill: WATER.fill, stroke: WATER.stroke, width: 1, dash };
		return { stroke: WATER.stroke, width: waterType === 'river' ? 2.5 : 1.5, dash };
	}

	/** Road widths by Overture class; the rest (service roads, tracks) are narrow. */
	const ROAD_WIDTH: Record<string, number> = {
		motorway: 3,
		trunk: 3,
		primary: 3,
		secondary: 2.2,
		tertiary: 2.2,
		residential: 1.6,
		unclassified: 1.6,
		living_street: 1.6
	};
	/** Roads are a very light grey, so that they are never taken for runs. */
	const ROAD_STROKE = '#c6cbd2';
	function roadPaint(f: Feature) {
		const roadClass = f.properties?.roadClass;
		return {
			stroke: ROAD_STROKE,
			width: ROAD_WIDTH[roadClass] ?? 1.1,
			dash: roadClass === 'track' ? [4, 3] : undefined
		};
	}
	const CARPARK_PAINT = { fill: '#dde1e6', stroke: ROAD_STROKE, width: 0.8 };

	/** The scene's lines and footprints the trees keep clear of, with the runs and lifts. */
	const inTheWay = $derived([
		...features.features.filter((f) => isRun(f) || isLift(f)),
		...scene.features.filter((f) => !isWood(f))
	]);
	/** How far the trees stay from each, in metres: wider of the pistes than of everything else. */
	const TREE_CLEARANCE: Record<string, number> = {
		runSegment: 10,
		lift: 10,
		road: 5,
		building: 3,
		carpark: 3,
		water: 4,
		waterway: 4
	};
	const treeClearance = (f: Feature) => TREE_CLEARANCE[f.properties?.kind] ?? 10;

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
	let showBuildings = $state(true);
	let showRoads = $state(true);
	let showWater = $state(true);
	let showLabels = $state(true);
	let sunAzimuth = $state(231);
	let sunElevation = $state(48);
	let background = $state('#24344d');
	let backgroundGradient = $state(0.5);
	let autoRotate = $state(true);

	// The circle around the runs and lifts, which `pnpm diorama-scene` fits its scene to.
	const circle = $derived.by(() => {
		const points = shapesOf(features)
			.filter((s) => isRun(s.feature) || isLift(s.feature))
			.flatMap((s) => s.coords.flat());
		return points.length ? fitCircle(points) : null;
	});
	/**
	 * Height of the summit pin in metres: 70 on a large area, shorter on a small one so that it
	 * stays the same size against the diorama, and never so short that the hut hides it.
	 */
	const pinHeight = $derived(Math.min(70, Math.max(30, (circle?.radius ?? Infinity) * 0.032)));
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
			use: 'ski runs and lifts',
			url: 'https://openskidata.org/'
		},
		CREDITS.overture
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
		A variation of the <a href={resolve('/diorama')}>Mountain Diorama</a> with moving ski lifts, life-sized
		snowboarders and trees, and the buildings, roads, car parks and water around the resort as OpenStreetMap
		has them. Zoom in to find them.
	</p>
	<div class="location">
		<PromptField
			bind:value={draft}
			placeholder="location id"
			hint="⏎ load"
			aria-label="location id"
			onsubmit={go}
		/>
		{#if local || location?.missing.length}
			<div class="note">
				{#if local}from the app's own files{/if}{#if local && location?.missing.length};
				{/if}
				{#if location?.missing.length}
					no {location.missing.map((m) => (m === 'glb' ? 'terrain glb' : m)).join(' or ')} for
					{locationId}{#if location.missing.includes('glb')}: terrain built from elevation tiles{/if}
				{/if}
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
			{#if showRoads}
				<Drape data={scene} filter={isRoad} paint={roadPaint} />
			{/if}
			{#if showBuildings}
				<Drape data={scene} filter={isCarpark} paint={CARPARK_PAINT} />
			{/if}
			<Drape
				data={features}
				filter={isRun}
				paint={(f) => ({ stroke: DIFFICULTY[f.properties?.difficulty] ?? '#868e96', width: 3 })}
			/>
			{#if showWater}
				<!-- Over the contour lines: a hazard should never be hidden by them. -->
				<Drape data={scene} filter={(f) => isWater(f) || isWaterway(f)} paint={waterPaint} above />
			{/if}
			{#if riders}
				<Riders data={features} filter={isRun} every={90} speed={ridingSpeed} />
			{/if}
			{#if trees !== 'none'}
				<Trees
					data={trees === 'all' ? (everywhere ?? woods) : woods}
					avoid={inTheWay}
					clearance={treeClearance}
					density={6000}
					height={16}
					limit={120_000}
				/>
			{/if}
			<Carpet
				data={features}
				filter={isMagicCarpet}
				speed={(f) => (liftsMoving ? liftSpeed(f) : 0)}
			/>
			<Lift
				data={features}
				filter={isAerial}
				height={(f) => (isCableCar(f) ? 20 : isGondola(f) ? 14 : isRopeTow(f) ? 1.1 : 9)}
				stations={(f) => !isRopeTow(f)}
				carrier={(f) => (isCabin(f) ? 'cabin' : isRopeTow(f) ? 'ball' : 'chair')}
				shuttle={isCableCar}
				carrierEvery={(f) => (isGondola(f) ? 45 : isRopeTow(f) ? 12 : seats(f) >= 4 ? 28 : 14)}
				carrierSize={carrierWidth}
				speed={(f) => (liftsMoving ? liftSpeed(f) : 0)}
				carrierColor={(f) => (isCabin(f) ? '#f08c00' : '#e03131')}
				carrierModel={(f) =>
					isCableCar(f)
						? asset('/diorama/ropeway.glb')
						: isGondola(f)
							? asset('/diorama/gondola.glb')
							: !isRopeTow(f) && (seats(f) === 2 || seats(f) === 4)
								? asset(`/diorama/chairlift-${seats(f)}.glb`)
								: null}
				carrierParts={(f) => ({ Hood: f.properties?.bubble ? 0 : false })}
			/>
			{#if showBuildings}
				<Building data={scene} filter={isBuilding} height={buildingHeight} roofColor="#5c6670" />
			{/if}
			<Model
				src={asset('/diorama/summit-hut.glb')}
				data={features}
				filter={kind('locationPeak')}
				size={25}
				heading={200}
			/>
			<Marker data={features} filter={kind('locationPeak')} height={pinHeight} />
			{#if showLabels}
				<Label data={features} filter={isLift} text={(f) => f.properties?.nameEn} />
				<Label data={features} filter={kind('locationPeak')} altitude={pinHeight + 25}>
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
		<Toggle label="buildings" bind:checked={showBuildings} />
		<Toggle label="roads" bind:checked={showRoads} />
		<Toggle label="water" bind:checked={showWater} />
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
