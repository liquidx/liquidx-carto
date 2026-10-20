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
		skyline,
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
	import FujiMap from '$lib/diamond-fuji/FujiMap.svelte';
	import FujiScene from '$lib/diamond-fuji/FujiScene.svelte';
	import { SNOW_LINE_BY_MONTH, type Conditions } from '$lib/diamond-fuji/scene';
	import Toggle from '$lib/components/Toggle.svelte';
	import type { LngLat } from '$lib/diamond-fuji/geo';
	import Skyline from '$lib/diamond-fuji/Skyline.svelte';
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

	/** The sun's centre every two minutes over the hour around the crossing. */
	const sunPath = $derived.by(() => {
		if (!alignment) return [];
		return Array.from({ length: 61 }, (_, i) => {
			const time = alignment.time + (i - 30) * 120_000;
			const s = sunPosition(time, observer.lat, observer.lon);
			return { azimuth: s.azimuth, apparent: s.apparent, time };
		});
	});
	const sunNow = $derived(sunPath[30] ?? null);

	// ── where ───────────────────────────────────────────

	const locus = $derived(diamondLocus(day, phase, terrain ? terrain.ground : () => 0, eye));
	const sky = $derived(grids ? skyline(observer, grids, line.bearing, 4) : null);

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

	/** Minutes before or after the crossing. */
	let minutes = $state(0);
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
	const previewTime = $derived((alignment?.time ?? day + 17 * 3_600_000) + minutes * 60_000);
	const previewSun = $derived.by(() => {
		const s = sunPosition(previewTime, observer.lat, observer.lon);
		return { azimuth: s.azimuth, altitude: s.apparent };
	});

	/** Buildings from re:earth in the preview: loaded on demand, for the view from here. */
	let showBuildings = $state(false);
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
		const half = hfov / 2 + 6;
		// Small buildings only matter close by; the big ones at zoom 12 can show from far off.
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
							built.push(buildingGeometry(tile, g, { origin }));
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
	let focalLength = $state(135);
	let exposure = $state(0.35);
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
	/** Look at the summit, a little above the middle of the frame. */
	const pitch = $derived(line.summitAngle - vfov * 0.12);

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
		Twice a year, from the right spot, the sun sets exactly on the summit of Mount Fuji. This works
		out where and when, from the sun's path, the terrain and the buildings between you and the
		mountain.
	</p>
	<ol class="steps">
		<li>
			<span class="step-n">1</span>
			<span>
				the map shades the land the summit shows from. click where you would stand, or search a
				place.
			</span>
		</li>
		<li>
			<span class="step-n">2</span>
			<span>the dates and times the sun sits on the summit from there appear below. pick one.</span>
		</li>
		<li>
			<span class="step-n">3</span>
			<span>
				find the exact streets and parks on that day's line, check the buildings in the way, and
				preview the moment.
			</span>
		</li>
	</ol>
</section>

<section>
	<SectionLabel index="01" label="Where you stand" descriptor="click the map to move" />
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
				<Toggle label="shade where it shows" bind:checked={showViewshed} />
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
		<div class="map">
			<FujiMap
				observer={point}
				{locus}
				view={{ bearing: line.bearing, hfov }}
				viewshed={viewshedLayer}
				{sectors}
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
		<div class="legend">
			<span>
				<span class="swatch shade"></span>
				land the summit shows from, standing on the ground: the deeper the shade, the more of the mountain
				{#if viewshedBusy}<span class="faint">· computing…</span>{/if}
			</span>
			<span
				><span class="swatch sector"></span>between these, the sun sits on the summit on some day of
				the year</span
			>
			<span><span class="swatch accent"></span>where it does on {fmtDate(day)}</span>
			<span><span class="swatch dashed"></span>your line of sight to the summit</span>
			<span><span class="swatch wedge"></span>what the lens in the preview takes in</span>
			{#if found?.spots.length}
				<span
					><span class="swatch dot"></span>places on the line ·
					<span class="swatch dot blocked"></span>something in the way</span
				>
			{/if}
		</div>
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
		<p class="note">
			{#if terrainError}
				<span class="error">terrain failed to load: {terrainError}</span>
			{:else if !terrain || !visibility}
				loading terrain…
			{:else if visibility.visible}
				the summit clears everything in between, by the terrain at {Math.round(
					terrain.resolution.region
				)} m in the region and {Math.round(terrain.resolution.mountain)} m on the mountain.
			{:else}
				<span class="warn">
					terrain at {km(visibility.blockedAt!.distance)} km, {Math.round(
						visibility.blockedAt!.elevation
					)} m high, stands {deg(visibility.blockedAt!.angle - line.summitAngle, 2)} above the summit
					from here.
				</span>
				you would see the sun set on that ridge instead.
			{/if}
		</p>
	</div>
</section>

<section>
	<SectionLabel index="02" label="When" descriptor={`${phase} · ${year}`} />
	<div class="body">
		<div class="when">
			<div class="windows">
				{#if windows.length}
					{#each windows as w (w.best.day)}
						<button
							class="window"
							class:current={w.days.some((d) => d.day === day)}
							onclick={() => (doy = Math.round((w.best.day - jstDay(year, 1)) / 86_400_000) + 1)}
						>
							<span class="when-date">{fmtDate(w.best.day)}</span>
							<span class="when-time">{fmtTime(w.best.time)}</span>
							<span class="when-note">
								centre {sunsOff(w.best.offset)} radii {w.best.offset >= 0 ? 'above' : 'below'} the summit
								{#if w.days.length > 1}
									· {w.days.length} days, {fmtDate(w.days[0].day)} – {fmtDate(w.days.at(-1)!.day)}
								{/if}
							</span>
						</button>
					{/each}
				{:else}
					<p class="note">
						from here the {phase} never lands on the summit: its bearing is outside the sun's
						{phase === 'sunset' ? 'setting' : 'rising'} points over the year.
					</p>
				{/if}
			</div>
			<div class="year">
				<Select
					label="year"
					options={yearOptions}
					value={String(year)}
					onchange={(v) => (year = Number(v))}
				/>
			</div>
		</div>
		<YearStrip {days} {year} {doy} onpick={(d) => (doy = d)} />
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
			{fmtDate(day)} runs through, within reach of where you stand now. each is pinned to the point where
			it meets the line, to within the width of the sun. the terrain is checked from there, and buildings
			can be checked too, below; trees cannot.
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
									{km(s.fromCentre)} km from you · {km(s.toSummit)} km to the summit ·
									{fmtTime(s.time)} · sun {Math.abs(s.offset).toFixed(2)}°
									{s.offset >= 0 ? 'above' : 'below'}
								</span>
								<span class="spot-sight" class:warn={!s.visibility.visible}>
									{#if s.visibility.visible}
										summit in sight over the terrain
									{:else}
										a ridge {km(s.visibility.blockedAt!.distance)} km away stands in the way
									{/if}
								</span>
								{#if obstructions.has(s.id)}
									{@const o = obstructions.get(s.id)}
									<span class="spot-sight" class:warn={!!o}>
										{#if o}
											a building {Math.round(o.distance)} m away, {Math.round(
												o.top - o.sightHeight
											)}
											m taller than the line of sight
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
					<span class="note">
						re:earth buildings, from overture maps footprints: the first kilometre and a half of
						every sightline for small buildings, fifteen for towers.
					</span>
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
					the line for {fmtDate(day)} is drawn on the map.
				</p>
			{/if}
		{/if}
	</div>
</section>

<section>
	<SectionLabel
		index="04"
		label="The view"
		descriptor={`${fmtDate(day)} · looking ${deg(line.bearing)}`}
	/>
	<div class="body">
		{#if alignment}
			<p class="note">
				at {fmtTime(alignment.time)} the sun is on the summit's bearing, its centre
				{deg(Math.abs(alignment.offset), 2)} ({sunsOff(alignment.offset)} radii)
				{alignment.offset >= 0 ? 'above' : 'below'} the top.
				{#if Math.abs(alignment.offset) <= SUN_RADIUS}
					<span class="accent">the disc touches the summit: diamond fuji.</span>
				{/if}
				the skyline is the terrain as seen from your eye, {Math.round(observer.elevation)} m up, with
				the earth's curve and refraction; the sun is drawn to scale, every two minutes.
			</p>
		{:else}
			<p class="note">the sun does not cross the summit's bearing on this day.</p>
		{/if}
		<div class="sky">
			<Skyline
				skyline={sky}
				bearing={line.bearing}
				summitAngle={line.summitAngle}
				path={sunPath}
				sun={sunNow}
			/>
		</div>
	</div>
</section>

<section>
	<SectionLabel
		index="05"
		label="Preview"
		descriptor={`${fmtDate(day)} · ${fmtTime(previewTime)} · ${focalLength} mm`}
	/>
	<div class="body">
		<p class="note">
			how it should look through the lens from where you stand: the real terrain, lit by the sun
			where it is at this moment, under a physical sky. the air, the cloud and the snow are yours to
			set.
			{#if previewSun.altitude < -0.3}
				<span class="faint">the sun is below the horizon now.</span>
			{/if}
		</p>
		<div class="preview">
			<FujiScene
				{grids}
				{observer}
				sun={previewSun}
				bearing={line.bearing}
				{pitch}
				{conditions}
				buildings={buildingGeometries}
				animate={playing || cloud > 0}
			/>
		</div>
		<div class="time-row">
			<div class="time-slider">
				<Slider
					label="time"
					bind:value={minutes}
					min={-40}
					max={40}
					step={1}
					format={(v) =>
						`${fmtTime(previewTime)} · ${v === 0 ? 'on the bearing' : `${Math.abs(v)} min ${v < 0 ? 'before' : 'after'}`}`}
				/>
			</div>
			<Toggle label="play" bind:checked={playing} />
			<Toggle label="buildings" bind:checked={showBuildings} />
		</div>
		{#if showBuildings}
			<p class="note">
				{buildingsStatus || 'loading buildings…'}
				<span class="faint"
					>· re:earth buildings, overture maps footprints with their heights, stood on this terrain</span
				>
			</p>
		{/if}
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
				min={24}
				max={600}
				step={1}
				unit=" mm"
				format={(v) => v.toFixed(0)}
			/>
			<Slider
				label="exposure"
				bind:value={exposure}
				min={0.2}
				max={1.5}
				step={0.05}
				format={(v) => v.toFixed(2)}
			/>
		</div>
	</div>
</section>

<section>
	<SectionLabel index="06" label="Terrain" />
	<div class="body">
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
		<p class="note">
			the summit is kengamine, {FUJI.elevation} m at {FUJI.lat.toFixed(4)}°, {FUJI.lon.toFixed(4)}°.
			the sun is placed with the noaa algorithm and lifted by atmospheric refraction; distant ground
			is lowered by the earth's curvature less a refraction coefficient of 0.13. times are jst.
		</p>
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
	.steps {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
		gap: 16px 40px;
		max-width: 900px;
	}
	.steps li {
		display: flex;
		gap: 12px;
		font-size: var(--text-small);
		line-height: 1.7;
		color: var(--color-text-secondary);
	}
	.step-n {
		color: var(--color-accent);
		letter-spacing: var(--tracking-micro);
	}
	.swatch.shade {
		height: 10px;
		border: 0;
		background: linear-gradient(90deg, rgba(54, 182, 233, 0.15), rgba(54, 182, 233, 0.6));
	}
	.swatch.sector {
		border-top: 1px dashed var(--color-text);
		opacity: 0.6;
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
	}
	.eye {
		display: flex;
		flex-direction: column;
		gap: 18px;
		gap: 16px 32px;
		align-items: end;
	}
	.map {
		height: 520px;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
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
	.swatch.dashed {
		border-top: 1px dashed var(--color-text-ui);
	}
	.swatch.dot {
		width: 8px;
		height: 8px;
		border: 0;
		background: var(--color-accent);
	}
	.swatch.dot.blocked {
		background: var(--color-text-tertiary);
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
	.swatch.wedge {
		height: 8px;
		border: 0;
		background: var(--color-accent-tint);
		outline: 1px solid var(--color-accent-muted);
	}
	.preview {
		max-width: 1000px;
	}
	.time-row {
		max-width: 1000px;
		display: flex;
		align-items: flex-end;
		gap: 32px;
	}
	.time-slider {
		flex: 1;
	}
	.controls {
		max-width: 1000px;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr));
		gap: 36px 48px;
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
	.when {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 24px 48px;
	}
	.windows {
		display: flex;
		flex-wrap: wrap;
		gap: 24px 64px;
	}
	.window {
		appearance: none;
		background: none;
		border: 0;
		padding: 0;
		margin: 0;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 6px;
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
	.when-time {
		font-size: var(--text-title);
		color: var(--color-text-secondary);
	}
	.when-note {
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
	}
	.year {
		width: 120px;
	}
	.sky {
		max-width: 1000px;
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
		.provider {
			grid-template-columns: 1fr;
		}
		.map {
			height: 60vh;
		}
		.when-date {
			font-size: 32px;
		}
	}
</style>
