<!--
	A ski resort on a diorama. The resort's runs and lifts, its scene (woods, water, buildings,
	roads and car parks from OpenStreetMap) and its terrain GLB are fetched from snowline by
	location id (`?locationId=`, or the resort picked below the title) and swapped in place when it
	changes; without an id, the default location comes from the app's own `static/diorama`
	files. A location without a GLB has its terrain built from elevation tiles. Runs, roads
	and water are draped on the snow, with lifts, trees, buildings and labels from
	`@liquidx/diorama` standing on it.
-->
<script lang="ts">
	import type { Feature, FeatureCollection, Polygon } from 'geojson';
	import { untrack } from 'svelte';
	import chairlift1 from '@liquidx/diorama/models/chairlift-1.glb?url';
	import chairlift2 from '@liquidx/diorama/models/chairlift-2.glb?url';
	import chairlift3 from '@liquidx/diorama/models/chairlift-3.glb?url';
	import chairlift4 from '@liquidx/diorama/models/chairlift-4.glb?url';
	import gondola from '@liquidx/diorama/models/gondola.glb?url';
	import liftStation from '@liquidx/diorama/models/lift-station.glb?url';
	import ropeway from '@liquidx/diorama/models/ropeway.glb?url';
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
		Riders,
		Trees,
		buildDiorama,
		terrainStyles,
		type DioramaData,
		type LabelVariant,
		type TerrainPreset,
		type TerrainStyle
	} from '@liquidx/diorama';
	import Combobox from '$lib/components/Combobox.svelte';
	import DataCredits from '$lib/components/DataCredits.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { PROVIDERS } from '$lib/contour/terrain-api';
	import { CREDITS, type Credit } from '$lib/credits';
	import { circleBounds, fitCircle, fitPoints } from '$lib/diorama/fit';
	import {
		fetchLocation,
		isLocationId,
		type LocationData,
		type LocationFeatures
	} from '$lib/diorama/location';
	import { locationOptions } from '$lib/diorama/locations';
	import { circleSampler } from '$lib/diorama/sampler';

	let { data } = $props();

	/** The location on show, or on its way: the id follows the URL and the selector. */
	let locationId = $state(untrack(() => data.locationId));
	/** Every resort there is data for; one named only in the URL is shown without being listed. */
	const resorts = $derived(locationOptions(data.locations));
	let location = $state.raw<LocationData | null>(null);
	let loading = $state(false);
	let message = $state('');

	/**
	 * Each request is a new object, so asking for the same id again after a failure retries it.
	 * `local` reads the app's own files instead of snowline: only for the default location,
	 * when the URL names none.
	 */
	let request = $state.raw(untrack(() => ({ id: data.locationId, local: data.local })));
	const local = $derived(location !== null && request.local);

	/** Switch locations: from the selector, or from the URL changing under us. */
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
		untrack(() => go(fromUrl, local));
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
	/** The chair models there are, by how many they seat. */
	const chairlifts: Record<number, string> = {
		1: chairlift1,
		2: chairlift2,
		3: chairlift3,
		4: chairlift4
	};
	/** Width of a carrier in metres: a seat's worth each for a chair, a cabin by how many it holds. */
	function carrierWidth(f: Feature) {
		const n = seats(f);
		if (isCableCar(f)) return 2.8;
		if (isRopeTow(f)) return 0.3;
		if (!isGondola(f)) return n * 0.55 + 0.2;
		return n >= 8 ? 2.4 : n >= 6 ? 2.1 : 1.8;
	}
	/** A lift that no longer runs: its towers and cable stand, with nothing on them. */
	const isOutOfService = (f: Feature) =>
		f.properties?.status === 'disused' || f.properties?.status === 'abandoned';
	/** A lift's name for its label, marked ⛔ when it no longer runs. */
	function liftName(f: Feature) {
		const name = f.properties?.nameEn;
		return name && isOutOfService(f) ? `⛔ ${name}` : name;
	}
	/** Metres a second: from the ride time where the lift has one, else typical for its kind. */
	function liftSpeed(f: Feature) {
		if (isOutOfService(f)) return 0;
		const { lengthMeters, durationSecs } = f.properties ?? {};
		if (lengthMeters && durationSecs) return lengthMeters / durationSecs;
		if (isCarpet(f)) return 0.7;
		return isCableCar(f) ? 8 : isGondola(f) ? 5 : seats(f) >= 4 && !isRopeTow(f) ? 4 : 2;
	}

	/** The colour of a run by its difficulty, with `other` for one that has none of these. */
	let runColors = $state({
		easy: '#2f9e44',
		intermediate: '#d6336c',
		advanced: '#212529',
		other: '#868e96'
	});
	// How far the view is from what it looks at, in radii of the diorama.
	let distance = $state<number>();
	/**
	 * How far towards white the runs are drawn: their own colour from afar, and paler as the view
	 * closes in, where a run is wide on screen and would weigh on the snow. It moves in steps,
	 * so that the runs are not drawn again on every frame of a zoom.
	 */
	const runPaleness = $derived.by(() => {
		const near = Math.min(1, Math.max(0, (1.5 - (distance ?? Infinity)) / 1.2));
		return Math.round(near * 5) / 10;
	});
	/** `hex` mixed `amount` of the way to white. */
	function paler(hex: string, amount: number) {
		const mixed = [1, 3, 5].map((at) => {
			const channel = parseInt(hex.slice(at, at + 2), 16);
			return Math.round(channel + (255 - channel) * amount);
		});
		return `rgb(${mixed.join(' ')})`;
	}
	const runColor = (f: Feature) =>
		paler(
			runColors[f.properties?.difficulty as keyof typeof runColors] ?? runColors.other,
			runPaleness
		);
	/**
	 * Size of the texture the runs, roads and water are drawn into: twice as fine once the view
	 * is close enough for its pixels to show.
	 */
	const drapeResolution = $derived((distance ?? Infinity) < 1.2 ? 4096 : 2048);
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
	let labelVariant = $state<LabelVariant>('dark');
	let sunAzimuth = $state(231);
	let sunElevation = $state(48);
	let background = $state('#24344d');
	let backgroundGradient = $state(0.5);
	let autoRotate = $state(true);

	// The circle around the runs, lifts and resort area, which `pnpm diorama-scene` fits its scene to.
	const circle = $derived.by(() => {
		const points = fitPoints(features);
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
			message = 'The features have no runs, lifts or resort area to fit the terrain to.';
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
		CREDITS.snowline,
		CREDITS.openSkiData,
		CREDITS.overture,
		CREDITS.awsTerrain
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
		<Combobox
			label="resort"
			placeholder={locationId}
			searchPlaceholder="search resorts"
			options={resorts}
			value={locationId}
			onchange={(id) => go(id)}
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
			rotateSpeed={-1.2}
			bind:distance
			{drapeResolution}
			rotateButton
			minDistance={0.1}
			labels={showLabels}
			{labelVariant}
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
			<Drape data={features} filter={isRun} paint={(f) => ({ stroke: runColor(f), width: 3 })} />
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
					limit={400_000}
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
				height={(f) => (isCableCar(f) ? 20 : isGondola(f) ? 14 : isRopeTow(f) ? 1.1 : 4.5)}
				clearance={(f) => (isCabin(f) || isRopeTow(f) ? 0 : 4.2)}
				stations={(f) => !isRopeTow(f)}
				stationModel={(f) => (isCabin(f) ? null : liftStation)}
				carrier={(f) => (isCabin(f) ? 'cabin' : isRopeTow(f) ? 'ball' : 'chair')}
				shuttle={isCableCar}
				carrierEvery={(f) =>
					isOutOfService(f) ? 0 : isGondola(f) ? 45 : isRopeTow(f) ? 12 : seats(f) >= 4 ? 28 : 14}
				carrierSize={carrierWidth}
				speed={(f) => (liftsMoving ? liftSpeed(f) : 0)}
				carrierColor={(f) => (isCabin(f) ? '#f08c00' : '#e03131')}
				carrierModel={(f) =>
					isCableCar(f)
						? ropeway
						: isGondola(f)
							? gondola
							: isRopeTow(f)
								? null
								: chairlifts[seats(f)]}
				carrierParts={(f) => ({ Hood: f.properties?.bubble ? 0 : false })}
			/>
			{#if showBuildings}
				<Building data={scene} filter={isBuilding} height={buildingHeight} roofColor="#5c6670" />
			{/if}
			<Marker data={features} filter={kind('locationPeak')} height={pinHeight} />
			<!-- Lift names once the view is close enough to make out the chairs. -->
			<Label data={features} filter={isLift} text={liftName} maxDistance={1} />
			<Label data={features} filter={kind('locationPeak')} altitude={pinHeight + 25}>
				{#snippet children(f)}<strong>{f.properties?.maxElevation} m</strong>{/snippet}
			</Label>
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
		<div class="control">
			<span class="label">labels</span>
			<Segmented
				label="label style"
				options={[{ value: 'light' }, { value: 'dark' }, { value: 'halo' }]}
				bind:value={labelVariant}
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
		{#each ['easy', 'intermediate', 'advanced', 'other'] as const as difficulty (difficulty)}
			<label class="control">
				<span class="label">{difficulty} runs</span>
				<input class="swatch" type="color" bind:value={runColors[difficulty]} />
			</label>
		{/each}
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
