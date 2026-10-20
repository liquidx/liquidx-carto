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
		type Observer
	} from '$lib/diamond-fuji/alignment';
	import FujiMap from '$lib/diamond-fuji/FujiMap.svelte';
	import type { LngLat } from '$lib/diamond-fuji/geo';
	import Skyline from '$lib/diamond-fuji/Skyline.svelte';
	import { SPOTS } from '$lib/diamond-fuji/spots';
	import {
		SUN_RADIUS,
		daysInYear,
		fmtDate,
		fmtTime,
		jstDay,
		jstParts,
		sunPosition,
		type Phase
	} from '$lib/diamond-fuji/sun';
	import { elevationAt, loadTerrain, type Terrain } from '$lib/diamond-fuji/terrain';
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

	const observer = $derived<Observer>({ ...point, elevation: (ground ?? 0) + eye });
	const line = $derived(sightline(observer));
	/** You can only watch the sun set behind the mountain from its sunrise side, and so on. */
	const phase = $derived<Phase>(line.bearing > 180 ? 'sunset' : 'sunrise');

	const visibility = $derived(terrain ? lineOfSight(observer, terrain.ground) : null);

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
	const sky = $derived(
		terrain ? skyline(observer, [terrain.mountain, terrain.region], line.bearing, 4) : null
	);

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
		Twice a year, from the right spot, the sun sets exactly on the summit of Mount Fuji. Pick a
		place to stand and this works out which days and what time, from the sun's path and the terrain
		between you and the mountain. Pick a day and it draws the line of places it happens from.
	</p>
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
			<FujiMap observer={point} {locus} onpick={(p) => goTo(p, 'picked on the map')} />
		</div>
		<div class="legend">
			<span
				><span class="swatch accent"></span>where the sun sets on the summit on {fmtDate(day)}</span
			>
			<span><span class="swatch dashed"></span>your line of sight to the summit</span>
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
	<SectionLabel index="04" label="Terrain" />
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
