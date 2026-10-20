<script lang="ts">
	import DataCredits from '$lib/components/DataCredits.svelte';
	import PlaceSearch from '$lib/components/PlaceSearch.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import Select from '$lib/components/Select.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import StatRow from '$lib/components/StatRow.svelte';
	import { PROVIDERS, findProvider } from '$lib/contour/terrain-api';
	import { CREDITS } from '$lib/credits';
	import {
		FUJI,
		alignmentDays,
		alignmentOn,
		diamondLocus,
		diamondWindows,
		lineOfSight,
		sightline,
		type Elevation,
		type Observer
	} from '$lib/diamond-fuji/alignment';
	import Button from '$lib/components/Button.svelte';
	import type * as THREE from 'three';
	import {
		buildingGeometry,
		loadBuildingTile,
		obstruction,
		sightlineTiles,
		tileBounds,
		tilesAround,
		type BuildingTile,
		type Obstruction,
		type TileId
	} from '$lib/diamond-fuji/buildings';
	import { angleDiff, bearing as bearingTo } from '$lib/diamond-fuji/geo';
	import Chip from '$lib/components/Chip.svelte';
	import { findSpots, type FindResult, type Spot, type SpotKind } from '$lib/diamond-fuji/finder';
	import FujiMap, { type SunRay } from '$lib/diamond-fuji/FujiMap.svelte';
	import FujiScene, { type SunPath } from '$lib/diamond-fuji/FujiScene.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import { SNOW_LINE_BY_MONTH, type Conditions } from '$lib/diamond-fuji/scene';
	import Toggle from '$lib/components/Toggle.svelte';
	import type { LngLat } from '$lib/diamond-fuji/geo';
	import { SPOTS } from '$lib/diamond-fuji/spots';
	import {
		SUN_RADIUS,
		daysInYear,
		fmtDate,
		fmtTime,
		jstDay,
		jstMidnight,
		jstParts,
		sunPosition,
		timeAtAltitude,
		type Phase
	} from '$lib/diamond-fuji/sun';
	import {
		elevationAt,
		loadPatch,
		loadTerrain,
		REGION,
		type Patch,
		type Terrain
	} from '$lib/diamond-fuji/terrain';
	import type { ViewshedRequest, ViewshedResponse } from '$lib/diamond-fuji/viewshed.worker';
	import { xToLon, yToLat } from '$lib/contour/mercator';
	import YearStrip from '$lib/diamond-fuji/YearStrip.svelte';

	let { data } = $props();

	// ── where you stand ─────────────────────────────────

	let spotId = $state<string>(SPOTS[0].id);
	let point = $state<LngLat>({ lon: SPOTS[0].lon, lat: SPOTS[0].lat });
	/** Height of the eye above the ground, in metres. */
	let eye = $state(SPOTS[0].eye);
	/** A name for a place picked from the search, if that is how it was chosen. */
	let placeName = $state('');

	function goTo(p: LngLat, name = '', height = 1.6) {
		point = { lon: p.lon, lat: p.lat };
		placeName = name;
		eye = height;
		spotId = name ? '' : spotId;
	}

	function pickSpot(id: string) {
		const s = SPOTS.find((s) => s.id === id);
		if (!s) return;
		spotId = id;
		goTo(s, '', s.eye);
		spotId = id;
	}

	const spotOptions = $derived([
		...(spotId ? [] : [{ value: '', label: placeName || 'picked on the map' }]),
		...SPOTS.map((s) => ({ value: s.id, label: s.label }))
	]);

	// ── terrain ─────────────────────────────────────────

	let providerId = $state(PROVIDERS[0].id);
	const provider = $derived(findProvider(providerId));

	let terrain = $state.raw<Terrain | null>(null);
	let terrainError = $state('');
	$effect(() => {
		const p = provider;
		const ctrl = new AbortController();
		terrain = null;
		terrainError = '';
		loadTerrain(p, ctrl.signal)
			.then((t) => {
				if (!ctrl.signal.aborted) terrain = t;
			})
			.catch((e) => {
				if (!ctrl.signal.aborted) terrainError = (e as Error).message;
			});
		return () => ctrl.abort();
	});

	/** The ground under the observer from a detailed tile, refreshed when they move. */
	let ground = $state<number | null>(null);
	$effect(() => {
		const { lon, lat } = point;
		const p = provider;
		let live = true;
		ground = null;
		elevationAt(p, lon, lat).then((z) => {
			if (live) ground = Number.isFinite(z) ? Math.max(0, z) : 0;
		});
		return () => {
			live = false;
		};
	});

	/** Finer ground around the observer, for the foreground of the view and the nearest ridges. */
	let patch = $state.raw<Patch | null>(null);
	$effect(() => {
		const { lon, lat } = point;
		const p = provider;
		const ctrl = new AbortController();
		patch = null;
		loadPatch(p, lon, lat, 24_000, 384, ctrl.signal)
			.then((t) => {
				if (!ctrl.signal.aborted) patch = t;
			})
			.catch(() => {});
		return () => ctrl.abort();
	});

	/** Every grid, finest first. */
	const grids = $derived(
		terrain ? [...(patch ? [patch.grid] : []), terrain.mountain, terrain.region] : null
	);
	const groundAt = $derived.by((): Elevation | null => {
		if (!terrain) return null;
		const t = terrain;
		const p = patch;
		return (lon, lat) => {
			if (p) {
				const z = p.sample(lon, lat);
				if (!Number.isNaN(z)) return z;
			}
			return t.ground(lon, lat);
		};
	});

	// ── where the mountain shows ────────────────────────

	let showViewshed = $state(true);
	let viewshedPixels = $state.raw<{
		pixels: Uint8ClampedArray;
		width: number;
		height: number;
	} | null>(null);
	let viewshedBusy = $state(false);
	const VIEWSHED_BOUNDS = {
		west: xToLon(REGION.x0),
		east: xToLon(REGION.x1),
		north: yToLat(REGION.y0),
		south: yToLat(REGION.y1)
	};
	$effect(() => {
		const t = terrain;
		if (!t) return;
		const worker = new Worker(new URL('$lib/diamond-fuji/viewshed.worker.ts', import.meta.url), {
			type: 'module'
		});
		viewshedBusy = true;
		worker.onmessage = (e: MessageEvent<ViewshedResponse>) => {
			viewshedPixels = { pixels: e.data.pixels, width: 320, height: 320 };
			viewshedBusy = false;
		};
		const request: ViewshedRequest = {
			id: 1,
			region: t.region,
			mountain: t.mountain,
			// A standing eye: the shading is about the ground, not any tower you might pick.
			options: { width: 320, height: 320, eye: 1.6 }
		};
		worker.postMessage(request);
		return () => worker.terminate();
	});
	const viewshedLayer = $derived(
		showViewshed && viewshedPixels ? { ...viewshedPixels, bounds: VIEWSHED_BOUNDS } : null
	);

	/**
	 * Between the solstice lines lies every day's line: the land from which the sun can sit on
	 * the summit at sunset (east of the mountain) or sunrise (west), on some day of the year.
	 */
	const sectors = $derived.by(() => {
		const ground = terrain ? terrain.ground : () => 0;
		const june = jstMidnight(year, 6, 21);
		const december = jstMidnight(year, 12, 21);
		const opts = { min: 2_000, max: 250_000, steps: 40 };
		return (['sunset', 'sunrise'] as Phase[]).map((ph) => {
			const a = diamondLocus(june, ph, ground, 1.6, opts);
			const b = diamondLocus(december, ph, ground, 1.6, opts);
			return [
				{ lon: FUJI.lon, lat: FUJI.lat },
				...a,
				...b.reverse(),
				{ lon: FUJI.lon, lat: FUJI.lat }
			];
		});
	});

	const observer = $derived<Observer>({ ...point, elevation: (ground ?? 0) + eye });
	const line = $derived(sightline(observer));
	/** You can only watch the sun set behind the mountain from its sunrise side, and so on. */
	const phase = $derived<Phase>(line.bearing > 180 ? 'sunset' : 'sunrise');

	const visibility = $derived(groundAt ? lineOfSight(observer, groundAt) : null);

	// ── when ────────────────────────────────────────────

	const today = jstParts(Date.now());
	let year = $state(today.year);
	let doy = $state(
		Math.round(
			(Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(today.year, 0, 1)) / 86_400_000
		) + 1
	);
	const day = $derived(jstDay(year, Math.min(doy, daysInYear(year))));
	const yearOptions = Array.from({ length: 6 }, (_, i) => ({ value: String(today.year - 1 + i) }));

	const days = $derived(alignmentDays(observer, year, phase));
	const windows = $derived(diamondWindows(days));
	const alignment = $derived(alignmentOn(observer, day, phase));

	// ── where ───────────────────────────────────────────

	const locus = $derived(diamondLocus(day, phase, terrain ? terrain.ground : () => 0, eye));

	/** Where the sun is, seen from here, as it comes down (or up) through the summit's height. */
	function sunAtSummitHeight(d: number) {
		const t = timeAtAltitude(d, observer.lat, observer.lon, line.summitAngle, phase);
		return t === null ? null : { time: t, ...sunPosition(t, observer.lat, observer.lon) };
	}
	const june = $derived(jstMidnight(year, 6, 21));
	const december = $derived(jstMidnight(year, 12, 21));
	/** On the maps: which way to look for the sun on the day, and at its two extremes. */
	const rays = $derived.by((): SunRay[] => {
		const out: SunRay[] = [];
		for (const [d, label, strong] of [
			[june, '21 jun', false],
			[december, '21 dec', false],
			[day, fmtDate(day), true]
		] as const) {
			const s = sunAtSummitHeight(d);
			if (s) out.push({ bearing: s.azimuth, label, strong });
		}
		return out;
	});

	/** The sun's path through the sky on a day, from well up to below the horizon, on whole minutes. */
	function pathOn(d: number) {
		const t0 = timeAtAltitude(d, observer.lat, observer.lon, 0, phase);
		if (t0 === null) return [];
		const start = Math.floor(t0 / 600_000) * 600_000;
		const dir = phase === 'sunset' ? 1 : -1;
		return Array.from({ length: 81 }, (_, i) => {
			const time = start + dir * (i - 70) * 120_000;
			const s = sunPosition(time, observer.lat, observer.lon);
			return { azimuth: s.azimuth, altitude: s.apparent, time };
		});
	}
	/**
	 * A path for the 21st of each month, and the chosen day's on top. Months either side of a
	 * solstice share a path near enough (january's sun is november's), so they share a line.
	 */
	const paths = $derived.by((): SunPath[] => {
		const pairs: [number, string][] = [
			[12, 'dec'],
			[1, 'jan · nov'],
			[2, 'feb · oct'],
			[3, 'mar · sep'],
			[4, 'apr · aug'],
			[5, 'may · jul'],
			[6, 'jun']
		];
		const out: SunPath[] = pairs.map(([m, label]) => ({
			label,
			strong: false,
			points: pathOn(jstMidnight(year, m, 21))
		}));
		out.push({ label: fmtDate(day), strong: true, points: pathOn(day) });
		return out;
	});

	// ── spots along the line ────────────────────────────

	/** Kilometres around the observer to look for places on the line. */
	let searchRadius = $state(8);
	let finding = $state(false);
	let findError = $state('');
	let found = $state.raw<FindResult | null>(null);
	/** What the search was for, so a change of day can say the results are stale. */
	let foundFor = $state<{ day: number; phase: Phase } | null>(null);
	let kindFilter = $state<SpotKind | 'all'>('all');
	let findController: AbortController | null = null;

	async function find() {
		findController?.abort();
		const ctrl = new AbortController();
		findController = ctrl;
		finding = true;
		findError = '';
		try {
			const r = await findSpots({
				day,
				phase,
				centre: point,
				radius: searchRadius * 1000,
				ground: groundAt ?? (() => 0),
				signal: ctrl.signal
			});
			if (ctrl.signal.aborted) return;
			found = r;
			foundFor = { day, phase };
			kindFilter = 'all';
		} catch (e) {
			if (!ctrl.signal.aborted) findError = (e as Error).message;
		} finally {
			if (!ctrl.signal.aborted) finding = false;
		}
	}

	const stale = $derived(foundFor !== null && (foundFor.day !== day || foundFor.phase !== phase));
	const KIND_LABELS: Record<SpotKind, string> = {
		park: 'parks',
		viewpoint: 'viewpoints',
		bridge: 'bridges',
		beach: 'beaches',
		street: 'streets',
		path: 'paths'
	};
	const kindCounts = $derived.by(() => {
		// Rebuilt whole each time, so it never needs to be reactive itself.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const counts = new Map<SpotKind, number>();
		for (const s of found?.spots ?? []) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
		return (Object.keys(KIND_LABELS) as SpotKind[])
			.filter((k) => counts.has(k))
			.map((k) => ({ kind: k, count: counts.get(k)! }));
	});
	const shownSpots = $derived(
		(found?.spots ?? []).filter((s) => kindFilter === 'all' || s.kind === kindFilter)
	);
	let showAll = $state(false);
	const LIST_LIMIT = 40;

	function goToSpot(s: Spot) {
		goTo(s, `${s.name} · ${KIND_LABELS[s.kind].replace(/s$/, '')}`, 1.6);
	}

	// ── buildings in the way ────────────────────────────

	/** Per spot id, what the sightline runs into; null when it is clear of buildings. */
	let obstructions = $state.raw<Map<string, Obstruction | null>>(new Map());
	let checking = $state<{ done: number; total: number } | null>(null);
	let checkError = $state('');

	async function checkBuildings() {
		const spots = shownSpots.slice(0, showAll ? undefined : LIST_LIMIT);
		const g = groundAt;
		if (!g) return;
		checking = { done: 0, total: spots.length };
		checkError = '';
		// A working copy, published whole after each spot, so it never needs to be reactive itself.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const results = new Map(obstructions);
		try {
			for (const s of spots) {
				const line = sightline({ ...s, elevation: (g(s.lon, s.lat) || 0) + 1.6 });
				const eye = { lon: s.lon, lat: s.lat, elevation: (g(s.lon, s.lat) || 0) + 1.6 };
				const tiles = (
					await Promise.all(sightlineTiles(s, line.bearing).map((t) => loadBuildingTile(t)))
				).filter((t): t is BuildingTile => t !== null);
				results.set(s.id, obstruction(tiles, eye, line.bearing, line.summitAngle, g));
				obstructions = new Map(results);
				checking = { done: checking!.done + 1, total: spots.length };
			}
		} catch (e) {
			checkError = (e as Error).message;
		} finally {
			checking = null;
		}
	}
	// A new search is a new set of places.
	$effect(() => {
		void found;
		obstructions = new Map();
	});

	const clearOf = (s: Spot) => s.visibility.visible && !obstructions.get(s.id);

	// ── the preview ─────────────────────────────────────

	/** Minutes before or after the crossing, and how far the slider reaches either way. */
	let minutes = $state(0);
	const RANGE = 90;
	let playing = $state(false);
	$effect(() => {
		if (!playing) return;
		const start = performance.now();
		const from = minutes;
		let frame = 0;
		const tick = () => {
			// A minute of sun a second, looping back round.
			minutes = Math.round(((from + (performance.now() - start) / 1000 + 40) % 80) - 40);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});
	/** The moment the slider counts from: the crossing, or failing that the sun at summit height. */
	/** The crossing counts only while the sun is still in the sky; long after sunset it's dark. */
	const crossingInSky = $derived(
		!!alignment && sunPosition(alignment.time, observer.lat, observer.lon).apparent > -1
	);
	const baseTime = $derived(
		(crossingInSky ? alignment?.time : null) ?? sunAtSummitHeight(day)?.time ?? day + 17 * 3_600_000
	);
	const previewTime = $derived(baseTime + minutes * 60_000);
	const previewSun = $derived.by(() => {
		const s = sunPosition(previewTime, observer.lat, observer.lon);
		return { azimuth: s.azimuth, altitude: s.apparent };
	});

	/** Buildings from re:earth in the view: on by default, loaded around where you stand. */
	let showBuildings = $state(true);
	let buildingGeometries = $state.raw<THREE.BufferGeometry[]>([]);
	let buildingsStatus = $state('');
	$effect(() => {
		if (!showBuildings || !groundAt) {
			buildingGeometries = [];
			buildingsStatus = '';
			return;
		}
		const g = groundAt;
		const origin = { lon: point.lon, lat: point.lat };
		const brg = line.bearing;
		// A wide arc towards the summit, fixed so a change of lens doesn't reload anything.
		const half = 45;
		// Everything close by in every direction; further out only big buildings, towards Fuji.
		const inView = (t: TileId) => {
			const b = tileBounds(t);
			const corners = [
				[b.west, b.north],
				[b.east, b.north],
				[b.west, b.south],
				[b.east, b.south]
			];
			const inside =
				origin.lon >= b.west &&
				origin.lon <= b.east &&
				origin.lat >= b.south &&
				origin.lat <= b.north;
			return (
				inside ||
				corners.some(
					([lon, lat]) => Math.abs(angleDiff(brg, bearingTo(origin, { lon, lat }))) < half
				)
			);
		};
		const wanted = [
			...tilesAround(origin, 14, 3_500),
			...tilesAround(origin, 13, 12_000).filter(inView),
			...tilesAround(origin, 12, 40_000).filter(inView)
		];
		let live = true;
		const built: THREE.BufferGeometry[] = [];
		let done = 0;
		let count = 0;
		buildingsStatus = `loading ${wanted.length} tiles…`;
		Promise.all(
			wanted.map((t) =>
				loadBuildingTile(t)
					.then((tile) => {
						if (!live) return;
						if (tile) {
							built.push(buildingGeometry(tile, g, { origin, clearOrigin: true }));
							count += tile.features.length;
							buildingGeometries = [...built];
						}
					})
					.catch((e: Error) => {
						if (live) buildingsStatus = e.message;
					})
					.finally(() => {
						if (!live) return;
						done++;
						if (done === wanted.length)
							buildingsStatus = `${count.toLocaleString('en')} buildings from ${wanted.length} tiles`;
						else if (!buildingsStatus.includes('http'))
							buildingsStatus = `loading ${done} of ${wanted.length} tiles…`;
					})
			)
		);
		return () => {
			live = false;
			for (const b of built) b.dispose();
		};
	});

	let haze = $state(0.25);
	let cloud = $state(0);
	let cloudBase = $state(1800);
	let focalLength = $state(24);
	let exposure = $state(1);
	const LENSES = [
		{ value: '24', label: '24 mm' },
		{ value: '50', label: '50 mm' },
		{ value: '135', label: '135 mm' },
		{ value: '400', label: '400 mm' }
	];
	let showConditions = $state(false);
	/** Snow follows the season until the slider is touched. */
	let snowTouched = $state(false);
	let snowLine = $state(SNOW_LINE_BY_MONTH[today.month - 1]);
	$effect(() => {
		const m = jstParts(day).month;
		if (!snowTouched) snowLine = SNOW_LINE_BY_MONTH[m - 1];
	});
	const conditions = $derived<Conditions>({
		haze,
		cloud,
		cloudBase,
		snowLine,
		focalLength,
		exposure
	});
	const hfov = $derived((2 * Math.atan(18 / focalLength) * 180) / Math.PI);
	const vfov = $derived(
		(2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / (16 / 9)) * 180) / Math.PI
	);
	/**
	 * Where the view looks. It starts on the summit, a little below the middle of the frame so the
	 * sky the sun comes down through shows, and comes back there whenever you move or change lens.
	 */
	let lookBearing = $state(0);
	let lookPitch = $state(0);
	function aim() {
		lookBearing = line.bearing;
		lookPitch = line.summitAngle + vfov * 0.2;
	}
	$effect(() => {
		void [line.bearing, line.summitAngle, vfov];
		aim();
	});

	const km = (m: number) => (m / 1000).toFixed(m < 20_000 ? 1 : 0);
	const deg = (d: number, n = 1) => d.toFixed(n) + '°';
	const sunsOff = (o: number) => Math.abs(o / SUN_RADIUS).toFixed(1);
</script>

<svelte:head><title>Diamond Fuji · Carto</title></svelte:head>

<section class="head">
	<h1>Diamond Fuji</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
	</div>
	<p>
		From the right spot, on two days a year, the sun sets exactly on the summit of Mount Fuji. Pick
		where you would stand, then move through the year to watch the sunset slide across the mountain.
	</p>
</section>

<section>
	<SectionLabel
		index="01"
		label="Where you stand"
		descriptor="click either map · drag the pin to fine-tune"
	/>
	<div class="body">
		<div class="bar">
			<div class="spot">
				<Select label="spot" options={spotOptions} value={spotId} onchange={pickSpot} />
			</div>
			<div class="search">
				<PlaceSearch
					placeholder="or search a place"
					onselect={(p) => goTo({ lon: p.lon, lat: p.lat }, p.name)}
				/>
			</div>
			<div class="eye">
				<Slider
					label="eye above ground"
					bind:value={eye}
					min={0}
					max={450}
					step={1}
					unit=" m"
					format={(v) => v.toFixed(0)}
				/>
			</div>
		</div>
		<div class="maps">
			<div class="map">
				<FujiMap
					kind="region"
					observer={point}
					{locus}
					{rays}
					view={{ bearing: lookBearing, hfov }}
					viewshed={viewshedLayer}
					{sectors}
					onpick={(p) => goTo(p, 'picked on the map')}
				/>
			</div>
			<div class="map">
				<FujiMap
					kind="local"
					observer={point}
					{locus}
					{rays}
					spots={(found?.spots ?? []).map((s) => ({
						id: s.id,
						lon: s.lon,
						lat: s.lat,
						clear: clearOf(s)
					}))}
					onpick={(p) => goTo(p, 'picked on the map')}
					onspot={(id) => {
						const s = found?.spots.find((s) => s.id === id);
						if (s) goToSpot(s);
					}}
				/>
			</div>
		</div>
		<div class="legend">
			<span><span class="swatch sight"></span>your line of sight to the summit</span>
			<span><span class="swatch ray"></span>where the sun is when it is the summit's height</span>
			<span>
				<span class="swatch sector"></span>the sun sits on the summit from here on some day of the
				year
			</span>
			<span><span class="swatch accent"></span>where it does on {fmtDate(day)}</span>
			<span>
				<Toggle label="shade where the mountain shows" bind:checked={showViewshed} />
				{#if viewshedBusy}<span class="faint">computing…</span>{/if}
			</span>
		</div>
		{#if terrainError}
			<p class="note error">terrain failed to load: {terrainError}</p>
		{:else if visibility && !visibility.visible}
			<p class="note warn">
				a ridge {km(visibility.blockedAt!.distance)} km away hides the summit from here: you would see
				the sun set on that ridge instead.
			</p>
		{/if}
	</div>
</section>

<section>
	<SectionLabel
		index="02"
		label="The view"
		descriptor={`${fmtDate(day)} · ${fmtTime(previewTime)} · ${focalLength} mm`}
	/>
	<div class="body">
		<div class="windows">
			{#each windows as w (w.best.day)}
				<button
					class="window"
					class:current={w.days.some((d) => d.day === day)}
					onclick={() => {
						doy = Math.round((w.best.day - jstDay(year, 1)) / 86_400_000) + 1;
						minutes = 0;
					}}
				>
					<span class="when-date">{fmtDate(w.best.day)}</span>
					<span class="when-time">{fmtTime(w.best.time)}</span>
				</button>
			{:else}
				<p class="note">
					from here the {phase} never lands on the summit: the line to it is outside the sun's
					{phase === 'sunset' ? 'setting' : 'rising'} points over the year.
				</p>
			{/each}
			<span class="windows-note">
				{#if windows.length}
					{phase === 'sunset' ? 'sunset' : 'sunrise'} on the summit from here, {year}
				{/if}
			</span>
		</div>
		<div class="view">
			<FujiScene
				{grids}
				{observer}
				sun={previewSun}
				bind:bearing={lookBearing}
				bind:pitch={lookPitch}
				{conditions}
				summit={{ bearing: line.bearing, angle: line.summitAngle }}
				{paths}
				buildings={buildingGeometries}
				animate={playing || cloud > 0}
			/>
		</div>
		<p class="note">
			{#if !terrain}
				loading terrain…
			{:else if alignment && Math.abs(alignment.offset) <= SUN_RADIUS}
				<span class="accent"
					>on {fmtDate(day)} the sun touches the summit at {fmtTime(alignment.time)}.</span
				>
			{:else if alignment}
				on {fmtDate(day)} the sun passes {Math.abs(alignment.offset).toFixed(1)}° {alignment.offset >=
				0
					? 'above'
					: 'below'} the summit.
			{:else}
				on {fmtDate(day)} the sun {phase === 'sunset' ? 'sets' : 'rises'} well to the side of the mountain.
			{/if}
			<span class="faint">
				each faint line is the sun's path on the 21st of a month; they sweep across the mountain
				over the year, and only on the days the path crosses the summit does the sun sit on it. drag
				the view to look around.
			</span>
		</p>
		<YearStrip {days} {year} {doy} onpick={(d) => (doy = d)} />
		<div class="time-row">
			<div class="time-slider">
				<Slider
					label="time"
					bind:value={minutes}
					min={-RANGE}
					max={RANGE}
					step={1}
					format={(v) =>
						`${fmtTime(previewTime)} · ${v === 0 ? (crossingInSky ? 'on the summit' : 'at summit height') : `${Math.abs(v)} min ${v < 0 ? 'before' : 'after'}`}`}
				/>
			</div>
			<Toggle label="play" bind:checked={playing} />
		</div>
		<div class="lens-row">
			<Segmented
				label="lens"
				options={LENSES}
				value={String(focalLength)}
				onchange={(v) => (focalLength = Number(v))}
			/>
			<Button size="sm" onclick={aim}>look at the summit</Button>
			<Toggle label="buildings" bind:checked={showBuildings} />
			<Toggle label="weather" bind:checked={showConditions} />
			<div class="year">
				<Select
					label="year"
					options={yearOptions}
					value={String(year)}
					onchange={(v) => (year = Number(v))}
				/>
			</div>
		</div>
		{#if showBuildings}
			<p class="note">
				{buildingsStatus || 'loading buildings…'}
				<span class="faint">· re:earth buildings, overture maps footprints with their heights</span>
			</p>
		{/if}
		{#if showConditions}
			<div class="controls">
				<Slider
					label="haze"
					bind:value={haze}
					min={0}
					max={1}
					step={0.01}
					format={(v) => (v < 0.2 ? 'crisp' : v < 0.5 ? 'clear' : v < 0.8 ? 'hazy' : 'murky')}
				/>
				<Slider
					label="cloud"
					bind:value={cloud}
					min={0}
					max={1}
					step={0.01}
					format={(v) =>
						v < 0.02 ? 'none' : v < 0.4 ? 'scattered' : v < 0.75 ? 'broken' : 'overcast'}
				/>
				<Slider
					label="cloud base"
					bind:value={cloudBase}
					min={500}
					max={4500}
					step={100}
					unit=" m"
					format={(v) => v.toFixed(0)}
				/>
				<Slider
					label="snow line"
					bind:value={snowLine}
					min={1500}
					max={4000}
					step={50}
					oninput={() => (snowTouched = true)}
					format={(v) => (v >= 3900 ? 'none' : `${v} m${snowTouched ? '' : ' · by season'}`)}
				/>
				<Slider
					label="lens"
					bind:value={focalLength}
					min={14}
					max={800}
					step={1}
					unit=" mm"
					format={(v) => v.toFixed(0)}
				/>
				<Slider
					label="exposure"
					bind:value={exposure}
					min={0.25}
					max={4}
					step={0.05}
					format={(v) => `${v.toFixed(2)}×`}
				/>
			</div>
		{/if}
	</div>
</section>

<section>
	<SectionLabel
		index="03"
		label="Where to stand"
		descriptor={found ? `${fmtDate(foundFor!.day)} · ${found.spots.length} places` : fmtDate(day)}
	/>
	<div class="body">
		<p class="note">
			streets, parks, bridges, beaches and viewpoints from openstreetmap that the line for
			{fmtDate(day)} runs through, near where you stand. pick one to stand there.
		</p>
		<div class="find-row">
			<div class="radius">
				<Slider
					label="search around you"
					bind:value={searchRadius}
					min={1}
					max={25}
					step={1}
					unit=" km"
					format={(v) => v.toFixed(0)}
				/>
			</div>
			<Button variant="primary" onclick={find} disabled={finding || !terrain}>
				{finding ? 'asking openstreetmap…' : found ? 'search again' : 'find places on the line'}
			</Button>
			{#if findError}
				<span class="error">{findError}</span>
			{/if}
		</div>
		{#if found}
			{#if stale}
				<p class="note warn">
					these places are for {fmtDate(foundFor!.day)}; the line has moved since. search again for {fmtDate(
						day
					)}.
				</p>
			{/if}
			{#if found.spots.length}
				<div class="kinds">
					<Chip active={kindFilter === 'all'} onclick={() => (kindFilter = 'all')}>
						all · {found.spots.length}
					</Chip>
					{#each kindCounts as k (k.kind)}
						<Chip active={kindFilter === k.kind} onclick={() => (kindFilter = k.kind)}>
							{KIND_LABELS[k.kind]} · {k.count}
						</Chip>
					{/each}
				</div>
				<ul class="spots">
					{#each showAll ? shownSpots : shownSpots.slice(0, LIST_LIMIT) as s (s.id)}
						<li>
							<button
								class="spot"
								class:blocked={!s.visibility.visible}
								onclick={() => goToSpot(s)}
							>
								<span class="spot-name">{s.name}</span>
								<span class="spot-kind">{KIND_LABELS[s.kind].replace(/s$/, '')}</span>
								<span class="spot-meta">
									{km(s.fromCentre)} km from you · {fmtTime(s.time)}
								</span>
								<span class="spot-sight" class:warn={!s.visibility.visible}>
									{#if s.visibility.visible}
										summit in sight
									{:else}
										a ridge {km(s.visibility.blockedAt!.distance)} km away is in the way
									{/if}
								</span>
								{#if obstructions.has(s.id)}
									{@const o = obstructions.get(s.id)}
									<span class="spot-sight" class:warn={!!o}>
										{#if o}
											a building {Math.round(o.distance)} m away is in the way
										{:else}
											no building in the way
										{/if}
									</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
				<div class="find-row">
					<Button onclick={checkBuildings} disabled={checking !== null}>
						{#if checking}
							checking {checking.done} of {checking.total}…
						{:else if obstructions.size}
							check buildings again
						{:else}
							check buildings along each sightline
						{/if}
					</Button>
					{#if checkError}
						<span class="error">{checkError}</span>
					{/if}
				</div>
				{#if shownSpots.length > LIST_LIMIT && !showAll}
					<Button size="sm" onclick={() => (showAll = true)}>
						show all {shownSpots.length}
					</Button>
				{/if}
			{:else}
				<p class="note">
					nothing mapped lies on the line within {searchRadius} km of you. widen the search, or move:
					the line for {fmtDate(day)} is drawn on the maps.
				</p>
			{/if}
		{/if}
	</div>
</section>

<section>
	<SectionLabel index="04" label="The numbers" />
	<div class="body">
		<StatRow
			stats={[
				{ value: km(line.distance), unit: 'km', label: 'to the summit' },
				{
					value: deg(line.bearing),
					label: `bearing · the sun ${phase === 'sunset' ? 'sets' : 'rises'} there`
				},
				{ value: deg(line.summitAngle, 2), label: 'summit above your horizontal' },
				{
					value: ground === null ? '…' : Math.round(observer.elevation),
					unit: 'm',
					label: `eye above sea level · ground ${ground === null ? '…' : Math.round(ground)} m`
				}
			]}
		/>
		<div class="notes">
			{#if alignment}
				<p class="note">
					on {fmtDate(day)} the sun is on the summit's bearing at {fmtTime(alignment.time)}, its
					centre {deg(Math.abs(alignment.offset), 2)} ({sunsOff(alignment.offset)} radii)
					{alignment.offset >= 0 ? 'above' : 'below'} the top. the disc touches the summit when that is
					under one radius, {deg(SUN_RADIUS, 2)}.
				</p>
			{/if}
			{#each windows as w (w.best.day)}
				<p class="note">
					{fmtDate(w.best.day)} at {fmtTime(w.best.time)}: centre {sunsOff(w.best.offset)} radii
					{w.best.offset >= 0 ? 'above' : 'below'} the summit{#if w.days.length > 1}; the disc
						touches it on {w.days.length} days, {fmtDate(w.days[0].day)} – {fmtDate(
							w.days.at(-1)!.day
						)}{/if}.
				</p>
			{/each}
			{#if visibility && terrain}
				<p class="note">
					{#if visibility.visible}
						the summit clears everything in between, by the terrain at {Math.round(
							terrain.resolution.region
						)} m in the region and {Math.round(terrain.resolution.mountain)} m on the mountain.
					{:else}
						terrain at {km(visibility.blockedAt!.distance)} km, {Math.round(
							visibility.blockedAt!.elevation
						)} m high, stands {deg(visibility.blockedAt!.angle - line.summitAngle, 2)} above the summit
						from here.
					{/if}
				</p>
			{/if}
			<p class="note">
				the summit is kengamine, {FUJI.elevation} m at {FUJI.lat.toFixed(4)}°, {FUJI.lon.toFixed(
					4
				)}°. the sun is placed with the noaa algorithm and lifted by atmospheric refraction; distant
				ground is lowered by the earth's curvature less a refraction coefficient of 0.13. times are
				jst. buildings come from re:earth; trees are not modelled.
			</p>
		</div>
		<div class="provider">
			<Select
				label="elevation"
				options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
				bind:value={providerId}
			/>
			<div class="note">
				{provider.coverage}<br />
				<span class="faint">{provider.attribution}</span>
			</div>
		</div>
	</div>
</section>

<DataCredits
	credits={[
		CREDITS.awsTerrain,
		CREDITS.mapterhorn,
		CREDITS.reearthTerrain,
		CREDITS.gsiDem,
		CREDITS.openFreeMap,
		CREDITS.overpass,
		CREDITS.reearthBuildings,
		CREDITS.nominatim
	]}
/>

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
	section + section {
		margin-top: 72px;
	}
	.head + section {
		margin-top: 64px;
	}
	.body {
		margin-top: 24px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.bar {
		display: grid;
		grid-template-columns: minmax(0, 320px) minmax(0, 1fr) minmax(0, 260px);
		gap: 16px 32px;
		align-items: end;
	}
	.maps {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 16px;
	}
	.map {
		height: 480px;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 32px;
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
	}
	.legend > span {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.swatch {
		display: inline-block;
		width: 24px;
		height: 0;
		border-top: 2px solid var(--color-accent);
	}
	.swatch.sight {
		border-top: 2px solid var(--color-text);
	}
	.swatch.ray {
		border-top: 2px dashed var(--color-warn);
	}
	.swatch.sector {
		height: 10px;
		border: 1px solid rgba(208, 162, 76, 0.5);
		background: rgba(208, 162, 76, 0.1);
	}
	.windows {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 16px 48px;
	}
	.window {
		appearance: none;
		background: none;
		border: 0;
		padding: 0;
		margin: 0;
		text-align: left;
		display: flex;
		align-items: baseline;
		gap: 14px;
		font-family: inherit;
		color: inherit;
		cursor: pointer;
	}
	.when-date {
		font-size: var(--text-display);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
		color: var(--color-text);
	}
	.window.current .when-date {
		color: var(--color-accent);
	}
	@media (hover: hover) {
		.window:not(.current):hover .when-date {
			color: var(--color-text-secondary);
		}
	}
	.when-time {
		font-size: var(--text-title);
		color: var(--color-text-secondary);
	}
	.windows-note {
		font-size: var(--text-small);
		color: var(--color-text-faint);
		padding-bottom: 4px;
	}
	.time-row,
	.lens-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 16px 32px;
	}
	.time-slider {
		flex: 1;
		min-width: 240px;
	}
	.year {
		width: 120px;
		margin-left: auto;
	}
	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr));
		gap: 36px 48px;
	}
	.find-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 16px 32px;
	}
	.radius {
		width: 280px;
		max-width: 100%;
	}
	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.spots {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
		gap: 24px 48px;
	}
	.spot {
		appearance: none;
		background: none;
		border: 0;
		padding: 0;
		margin: 0;
		width: 100%;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-family: inherit;
		color: inherit;
		cursor: pointer;
	}
	.spot-name {
		font-size: var(--text-list);
		color: var(--color-text);
	}
	.spot.blocked .spot-name {
		color: var(--color-text-tertiary);
	}
	@media (hover: hover) {
		.spot:hover .spot-name {
			color: var(--color-accent);
		}
	}
	.spot-kind {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.spot-meta,
	.spot-sight {
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
		line-height: 1.6;
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.note {
		max-width: 720px;
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
		line-height: 1.7;
	}
	.faint {
		color: var(--color-text-faint);
	}
	.warn {
		color: var(--color-warn);
	}
	.error {
		color: var(--color-danger);
	}
	.accent {
		color: var(--color-accent);
	}
	.provider {
		display: grid;
		grid-template-columns: minmax(0, 280px) 1fr;
		gap: 24px;
		align-items: end;
	}
	@media (max-width: 719px) {
		.head {
			padding-top: 48px;
		}
		.bar,
		.maps,
		.provider {
			grid-template-columns: 1fr;
		}
		.map {
			height: 50vh;
		}
		.when-date {
			font-size: 32px;
		}
		.year {
			margin-left: 0;
		}
	}
</style>
