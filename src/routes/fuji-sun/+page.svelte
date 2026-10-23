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
	} from '$lib/fuji-sun/alignment';
	import Button from '$lib/components/Button.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import type * as THREE from 'three';
	import {
		buildingAt,
		buildingGeometry,
		loadBuildingTile,
		tileBounds,
		tilesAround,
		tilesUnder,
		type BuildingTile,
		type TileId
	} from '$lib/fuji-sun/buildings';
	import { angleDiff, bearing as bearingTo } from '$lib/fuji-sun/geo';
	import FujiMap, { type SunRay } from '$lib/fuji-sun/FujiMap.svelte';
	import FujiScene, { type SunPath } from '$lib/fuji-sun/FujiScene.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import { SNOW_LINE_BY_MONTH, type Conditions } from '$lib/fuji-sun/scene';
	import Toggle from '$lib/components/Toggle.svelte';
	import type { LngLat } from '$lib/fuji-sun/geo';
	import { SPOTS } from '$lib/fuji-sun/spots';
	import { OFFICIAL, OFFICIAL_DEFINITION, OFFICIAL_SOURCE } from '$lib/fuji-sun/official';
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
	} from '$lib/fuji-sun/sun';
	import {
		elevationAt,
		loadPatch,
		loadTerrain,
		REGION,
		type Patch,
		type Terrain
	} from '$lib/fuji-sun/terrain';
	import type { ViewshedRequest, ViewshedResponse } from '$lib/fuji-sun/viewshed.worker';
	import { xToLon, yToLat } from '$lib/contour/mercator';
	import YearStrip from '$lib/fuji-sun/YearStrip.svelte';

	let { data } = $props();

	// ── where you stand ─────────────────────────────────

	/** Start on tokyo tower's deck: a sunset view most people can get to. */
	const START = SPOTS.find((s) => s.id === 'tokyo-tower') ?? SPOTS[0];
	let spotId = $state<string>(START.id);
	let point = $state<LngLat>({ lon: START.lon, lat: START.lat });
	/** Height of the eye above the ground, in metres. */
	let eye = $state(START.eye);
	/** A name for a place picked from the search, if that is how it was chosen. */
	let placeName = $state('');

	/** Counts moves, so a late building lookup can tell it is no longer where you stand. */
	let moves = 0;

	function goTo(p: LngLat, name = '', height = 1.6) {
		moves++;
		point = { lon: p.lon, lat: p.lat };
		placeName = name;
		eye = height;
		spotId = name ? '' : spotId;
	}

	let locating = $state(false);
	let locateError = $state('');

	/** Where the browser says you are, standing on the ground. */
	function goToCurrent() {
		if (!navigator.geolocation) {
			locateError = 'this browser cannot tell where you are';
			return;
		}
		locating = true;
		locateError = '';
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				locating = false;
				goTo({ lon: pos.coords.longitude, lat: pos.coords.latitude }, 'your location');
			},
			(e) => {
				locating = false;
				locateError = e.message || 'could not find your location';
			},
			{ enableHighAccuracy: true, timeout: 15_000 }
		);
	}

	/** A point picked on the map: on the ground, or on the roof of the building there. */
	async function pickOnMap(p: LngLat) {
		goTo(p, 'picked on the map');
		const move = moves;
		const tiles = await Promise.all(
			tilesUnder(p).map((t) => loadBuildingTile(t).catch(() => null))
		);
		if (move !== moves) return;
		const top = buildingAt(
			tiles.filter((t): t is BuildingTile => t !== null),
			p
		);
		if (top !== null) eye = Math.round(top + 1.6);
	}

	/** Our own spots and the kanto bureau's: the bureau's are picked on the map, not the list. */
	const ALL_SPOTS = [...SPOTS, ...OFFICIAL.map((s) => ({ ...s, label: `${s.num} · ${s.name}` }))];

	function pickSpot(id: string) {
		const s = ALL_SPOTS.find((s) => s.id === id);
		if (!s) return;
		spotId = id;
		goTo(s, '', s.eye);
		spotId = id;
	}

	/** The place you stand, as words. */
	const here = $derived(
		ALL_SPOTS.find((s) => s.id === spotId)?.label ??
			(placeName && placeName !== 'picked on the map' ? placeName : 'the spot on the map')
	);

	/** The bureau's spot, when that is where you stand. */
	const official = $derived(OFFICIAL.find((s) => s.id === spotId) ?? null);
	const spotOptions = $derived([
		...(spotId ? [] : [{ value: '', label: placeName || 'picked on the map' }]),
		...(official ? [{ value: official.id, label: `${official.num} · ${official.name}` }] : []),
		...SPOTS.map((s) => ({ value: s.id, label: s.label }))
	]);
	const MONTHS = [
		'jan',
		'feb',
		'mar',
		'apr',
		'may',
		'jun',
		'jul',
		'aug',
		'sep',
		'oct',
		'nov',
		'dec'
	];
	/** The first to the last of a run of days, as `7–9 feb`. */
	const spanOf = (days: { day: number }[]) => {
		const a = jstParts(days[0].day);
		const b = jstParts(days.at(-1)!.day);
		return fmtRange([a.month, a.day, b.month, b.day]);
	};
	const fmtRange = ([m1, d1, m2, d2]: [number, number, number, number]) =>
		m1 === m2 && d1 === d2
			? `${d1} ${MONTHS[m1 - 1]}`
			: m1 === m2
				? `${d1}–${d2} ${MONTHS[m1 - 1]}`
				: `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;

	// ── terrain ─────────────────────────────────────────

	let providerId = $state('reearth');
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
		const worker = new Worker(new URL('$lib/fuji-sun/viewshed.worker.ts', import.meta.url), {
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

	// ── the preview ─────────────────────────────────────

	/** Minutes before or after the crossing. */
	let minutes = $state(0);
	/** The crossing counts only while the sun is still in the sky; long after sunset it's dark. */
	const crossingInSky = $derived(
		!!alignment && sunPosition(alignment.time, observer.lat, observer.lon).apparent > -1
	);
	/** The moment the slider counts from: the crossing, or failing that the sun at summit height. */
	const baseTime = $derived(
		(crossingInSky ? alignment?.time : null) ?? sunAtSummitHeight(day)?.time ?? day + 17 * 3_600_000
	);
	/** The slider reaches over the afternoon and evening (or the night and morning), in JST. */
	const HOURS: Record<Phase, [number, number]> = { sunset: [12, 22], sunrise: [2, 12] };
	const span = $derived({
		lo: Math.ceil((day + HOURS[phase][0] * 3_600_000 - baseTime) / 60_000),
		hi: Math.ceil((day + HOURS[phase][1] * 3_600_000 - baseTime) / 60_000)
	});
	const offset = $derived(Math.max(span.lo, Math.min(span.hi, minutes)));
	let playing = $state(false);
	$effect(() => {
		if (!playing) return;
		const start = performance.now();
		const from = offset;
		const { lo, hi } = span;
		let frame = 0;
		const tick = () => {
			// Five minutes of sun a second, looping back round.
			const t = from - lo + ((performance.now() - start) / 1000) * 5;
			minutes = lo + Math.round(t % (hi - lo));
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});
	const previewTime = $derived(baseTime + offset * 60_000);
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
	const duration = (m: number) =>
		m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
</script>

<svelte:head><title>Fuji Sun · Carto</title></svelte:head>

<section class="head">
	<h1>Fuji Sun</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
	</div>
	<p>
		Find the days the sun rises or sets right on the summit of Mount Fuji, known as
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={OFFICIAL_DEFINITION} target="_blank" rel="noopener">Diamond Fuji</a> (ダイヤモンド富士).
	</p>
</section>

<section>
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
			<Button onclick={goToCurrent} disabled={locating}>
				{locating ? 'locating…' : 'current location'}
			</Button>
		</div>
		{#if locateError}
			<p class="note error">{locateError}</p>
		{/if}
		<div class="legend">
			<span><span class="swatch sight"></span>to the summit</span>
			<span><span class="swatch ray"></span>the sun</span>
			<span><span class="swatch sector"></span>on the summit some day</span>
			<span><span class="swatch accent"></span>on {fmtDate(day)}</span>
			<span>
				<span class="swatch dot"></span>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={OFFICIAL_SOURCE} target="_blank" rel="noopener">recommended locations</a>
			</span>
			<span>
				<Toggle label="Fuji visible" bind:checked={showViewshed} />
				{#if viewshedBusy}<span class="faint">computing…</span>{/if}
			</span>
		</div>
		{#if terrainError}
			<p class="note error">terrain failed to load: {terrainError}</p>
		{:else if visibility && !visibility.visible}
			<p class="note warn">
				a ridge {km(visibility.blockedAt!.distance)} km away hides the summit.
			</p>
		{/if}
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
					spots={OFFICIAL.map((s) => ({
						id: s.id,
						lon: s.lon,
						lat: s.lat,
						clear: true,
						muted: true
					}))}
					onpick={pickOnMap}
					onspot={pickSpot}
				/>
			</div>
			<div class="map">
				<FujiMap kind="local" observer={point} {locus} {rays} onpick={pickOnMap} />
			</div>
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
		{#if !terrain}
			<p class="note">loading terrain…</p>
		{/if}
		<YearStrip {days} {year} {doy} onpick={(d) => (doy = d)} />
		<div class="time-row">
			<div class="time-slider">
				<Slider
					label="time"
					bind:value={minutes}
					min={span.lo}
					max={span.hi}
					step={1}
					format={(v) =>
						`${fmtTime(previewTime)} · ${v === 0 ? (crossingInSky ? 'on the summit' : 'at summit height') : `${duration(Math.abs(v))} ${v < 0 ? 'before' : 'after'}`}`}
				/>
			</div>
			<Toggle label="play" bind:checked={playing} />
			<div class="year">
				<Select
					label="year"
					options={yearOptions}
					value={String(year)}
					onchange={(v) => (year = Number(v))}
				/>
			</div>
		</div>
		<div class="lens-row">
			<Segmented
				label="lens"
				options={LENSES}
				value={String(focalLength)}
				onchange={(v) => (focalLength = Number(v))}
			/>
			<div class="eye">
				<NumberField label="eye above ground" bind:value={eye} min={0} max={1000} unit="m" />
			</div>
			<Button size="sm" onclick={aim}>re-aim</Button>
			<Toggle label="buildings" bind:checked={showBuildings} />
			<Toggle label="weather" bind:checked={showConditions} />
			{#if showBuildings && buildingsStatus.startsWith('loading')}
				<span class="note faint">{buildingsStatus}</span>
			{/if}
		</div>
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
					label="exposure"
					bind:value={exposure}
					min={0.25}
					max={4}
					step={0.05}
					format={(v) => `${v.toFixed(2)}×`}
				/>
			</div>
		{/if}
		<div class="the-day">
			<div class="the-day-label">THE DAY</div>
			<p class="the-day-note">
				{#if windows.length}
					{phase} on the summit from {here}, {year}
				{:else}
					from {here} the {phase} never lands on the summit
				{/if}
			</p>
			{#if windows.length}
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
							{#if !w.touches}<span class="when-time faint">near</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
			{#if official}
				<p class="the-day-note">
					official listing: {official.dates.map(fmtRange).join(' · ') || 'none'}
					·
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={official.url} target="_blank" rel="noopener">source</a>
				</p>
			{/if}
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

<section>
	<SectionLabel index="01" label="The numbers" />
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
		{#if windows.length}
			<StatRow
				stats={windows.map((w) => ({
					value: fmtDate(w.best.day),
					unit: fmtTime(w.best.time),
					label: w.touches
						? w.days.length > 1
							? `disc on the summit ${spanOf(w.days)} · ${w.days.length} days`
							: 'disc on the summit this day only'
						: `near · centre passes ${Math.abs(w.best.offset).toFixed(2)}° ${w.best.offset >= 0 ? 'above' : 'below'}`
				}))}
			/>
		{/if}
		<div class="notes">
			{#if visibility && terrain}
				<p class="note">
					{#if visibility.visible}
						the summit is in clear sight.
					{:else}
						a {Math.round(visibility.blockedAt!.elevation)} m ridge {km(
							visibility.blockedAt!.distance
						)} km away hides it.
					{/if}
				</p>
			{/if}
		</div>
	</div>
</section>

<section>
	<SectionLabel index="02" label="How it's worked out" />
	<ol class="method">
		<li>
			<h3>The summit</h3>
			<p>
				The target is Kengamine (剣ヶ峰), the highest point of the crater rim: {FUJI.elevation} m at
				{FUJI.lat.toFixed(4)}° N, {FUJI.lon.toFixed(4)}° E.
			</p>
		</li>
		<li>
			<h3>Where you stand</h3>
			<p>
				Your eye is the ground under the pin, read from the elevation tiles chosen above, plus the
				eye height. From there the distance and compass bearing to the summit are measured along the
				great circle on a spherical earth.
			</p>
		</li>
		<li>
			<h3>How high the summit looks</h3>
			<p>
				The summit's angle above your horizontal comes from its height above you over that distance,
				lowered by the curve of the earth and raised again by the air bending light around it, taken
				as the surveyor's standard coefficient of 0.13. This sets how high the sun must be to sit on
				the peak.
			</p>
		</li>
		<li>
			<h3>Where the sun is</h3>
			<p>
				The sun's position comes from NOAA's solar calculator (after Meeus's Astronomical
				Algorithms), good to about 0.01°, with its height lifted by atmospheric refraction as it
				nears the horizon. Times are JST.
			</p>
		</li>
		<li>
			<h3>The moment and the days</h3>
			<p>
				For every day of the year, the time the sun's direction matches the summit's bearing is
				found by bisection: in the afternoon from east of the mountain, where it sets on the peak,
				or the morning from the west, where it rises. The sun's height at that moment, less the
				summit's, is how far it passes above or below. When that is under {SUN_RADIUS.toFixed(2)}°,
				half the sun's width, the disc touches the summit; days in a row that do make a window, and
				the closest of them is the day shown. Around the equinoxes the sun can step over the peak
				between one evening and the next, and around the solstices turn back just short of it; the
				closest day still counts, marked near, if the centre passes within one diameter.
			</p>
		</li>
		<li>
			<h3>What gets in the way</h3>
			<p>
				The line of sight is walked against the terrain, finer close to you and on the mountain,
				coarser across the region, to see whether a ridge rises above the summit. The shading on the
				map does the same from every point for a standing eye. Buildings come from re:earth
				(Overture footprints with heights) and are drawn in the view and checked along each
				sightline when asked. Trees are not modelled, and the weather settings only change the
				picture.
			</p>
		</li>
		<li>
			<h3>The recommended locations</h3>
			<p>
				The white dots are the
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={OFFICIAL_SOURCE} target="_blank" rel="noopener"
					>Kanto Regional Development Bureau's</a
				>
				diamond Fuji views, with the days it published from its own simulation. They are placed here from
				their names, so only roughly; from them this simulation lands within a day of the published date
				about four times in five.
			</p>
		</li>
	</ol>
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
		grid-template-columns: minmax(0, 320px) minmax(0, 1fr) auto;
		gap: 16px 32px;
		align-items: end;
	}
	/* The view sits right under the maps, as close as they are to each other. */
	.maps + .view {
		margin-top: -8px;
	}
	.maps {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 16px;
	}
	.map {
		height: 300px;
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
	.swatch.dot {
		width: 6px;
		height: 6px;
		border: 0;
		border-radius: 50%;
		background: #e6e6ea;
		opacity: 0.7;
	}
	.swatch.sector {
		height: 10px;
		border: 1px solid rgba(208, 162, 76, 0.5);
		background: rgba(208, 162, 76, 0.1);
	}
	.the-day {
		border: 1px solid var(--color-line);
		padding: 16px 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.the-day-label {
		font-size: var(--text-meta);
		letter-spacing: 0.14em;
		color: var(--color-text-label);
	}
	.head a,
	.legend a,
	.the-day-note a {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.the-day-note {
		max-width: 640px;
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
		line-height: 1.7;
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
	.time-row,
	.lens-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 16px 32px;
	}
	.eye {
		width: 160px;
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
	.method {
		list-style: none;
		margin: 24px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
		gap: 32px 48px;
		counter-reset: step;
	}
	.method li {
		counter-increment: step;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.method h3 {
		font-size: var(--text-meta);
		font-weight: 400;
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.method h3::before {
		content: counter(step, decimal-leading-zero) '  ';
		color: var(--color-accent);
	}
	.method p {
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
		line-height: 1.7;
	}
	.method a {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
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
			height: 40vh;
		}
		.when-date {
			font-size: 32px;
		}
		.year {
			margin-left: 0;
		}
	}
</style>
