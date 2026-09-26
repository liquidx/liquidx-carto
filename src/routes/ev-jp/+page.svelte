<script lang="ts">
	import BarChart from '$lib/components/BarChart.svelte';
	import ChargerMap from '$lib/components/ChargerMap.svelte';
	import PromptField from '$lib/components/PromptField.svelte';
	import RampLegend from '$lib/components/RampLegend.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Select from '$lib/components/Select.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import StatRow from '$lib/components/StatRow.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { BASEMAP_OPTIONS, type BasemapId } from '$lib/map/basemaps';
	import {
		blackspots,
		decodeChargers,
		decodeGrid,
		decodeRoutes,
		distanceAt,
		gridCells,
		landStats,
		type ChargerRow,
		type Network,
		type RawGrid
	} from '$lib/ev/model';
	import { BLACKSPOT, GRADIENT } from '$lib/ev/style';
	import chargerRows from '$lib/ev/data/chargers.json';
	import rawGrid from '$lib/ev/data/distance-grid.json';
	import rawRoutes from '$lib/ev/data/routes.json';

	let { data } = $props();

	const chargers = decodeChargers(chargerRows as ChargerRow[]);
	const grid = decodeGrid(rawGrid as RawGrid);
	const cells = gridCells(grid);
	const routes = decodeRoutes(rawRoutes);
	const HOKKAIDO: [number, number, number, number] = [139.75, 41.35, 145.9, 45.6];

	// ── headline ────────────────────────────────────────

	const fast = chargers.filter((c) => c.dc);
	const reach = landStats(grid, 'all');
	const longestGap = Math.max(...routes.map((r) => r.gap));
	const share24h = Math.round((fast.filter((c) => c.open24h).length / fast.length) * 100);

	// ── coverage ────────────────────────────────────────

	let network = $state<Network | 'off'>('all');
	let mode = $state<'gradient' | 'blackspots'>('gradient');
	let threshold = $state(25);
	let opacity = $state(1);
	let basemap = $state<BasemapId>('terrain');
	let probe = $state<{ lon: number; lat: number } | null>(null);
	let map: ChargerMap | undefined = $state();

	const spots = $derived(network === 'off' ? [] : blackspots(grid, network, threshold).slice(0, 8));

	const probeText = $derived.by(() => {
		if (!probe || network === 'off') return '';
		const d = distanceAt(grid, network, probe.lon, probe.lat);
		if (Number.isNaN(d)) return 'sea or outside hokkaido';
		return `${d} km to the nearest ${network === '24h' ? '24h ' : ''}fast charger`;
	});

	// ── chargers ────────────────────────────────────────

	let fastOnly = $state(true);
	let only24h = $state(false);
	let noCard = $state(false);
	let empOnly = $state(false);
	let query = $state('');

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return chargers.filter(
			(c) =>
				(!fastOnly || c.dc) &&
				(!only24h || c.open24h) &&
				(!noCard || !c.cardRequired) &&
				(!empOnly || c.emp) &&
				(!q || `${c.name} ${c.address}`.toLowerCase().includes(q))
		);
	});

	const fmtCoord = (lat: number, lon: number) => `${lat.toFixed(2)}° n · ${lon.toFixed(2)}° e`;
</script>

<svelte:head><title>EV Charging Japan · Carto</title></svelte:head>

<section class="head">
	<h1>EV Charging Japan</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
		<span>hokkaido · data as of 2026-06-01</span>
	</div>
	<p>
		Can an EV with 150–200 km of summer range tour Hokkaido? Every drivable corner sits within {reach.max}
		km of a CHAdeMO fast charger, and the thinnest leg on any touring route is {longestGap} km. Range
		is not what stops you. Opening hours are.
	</p>
</section>

<section class="stats">
	<StatRow
		stats={[
			{ value: fast.length, label: 'chademo fast chargers in hokkaido' },
			{ value: reach.max, unit: 'km', label: 'furthest any land sits from one' },
			{ value: longestGap, unit: 'km', label: 'longest gap on a touring route' },
			{ value: share24h, unit: '%', label: 'of fast chargers open 24 hours' }
		]}
	/>
</section>

<section>
	<SectionLabel index="01" label="Coverage" descriptor="straight-line distance, 4 km grid" />
	<div class="explorer">
		<div class="pane">
			<div class="map">
				<ChargerMap
					bind:this={map}
					bind:probe
					{cells}
					chargers={shown}
					{network}
					{mode}
					{threshold}
					{opacity}
					{basemap}
					bounds={HOKKAIDO}
				/>
			</div>
			<div class="row">
				{#if network !== 'off'}
					{#if mode === 'gradient'}
						<RampLegend colors={GRADIENT} min="0 km" max="40 km+" />
					{:else}
						<RampLegend colors={BLACKSPOT} min="{threshold} km" max="{threshold + 14} km+" />
					{/if}
				{/if}
				<span class="note probe">{probeText}</span>
			</div>

			{#if network !== 'off'}
				<div class="spots">
					<SectionLabel
						label="Blackspots"
						count={spots.length}
						descriptor="land beyond {threshold} km, largest first"
					/>
					{#if spots.length}
						<ul>
							{#each spots as s (s.lon + ',' + s.lat)}
								<li>
									<button type="button" onclick={() => map?.fitBounds(s.bounds)}>
										<span class="area">{s.area.toLocaleString('en')} km²</span>
										<span class="detail">worst {s.max} km · {fmtCoord(s.lat, s.lon)}</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="note">no land beyond {threshold} km.</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="panel">
			<div class="control">
				<span class="label">shading</span>
				<Segmented
					label="coverage network"
					options={[
						{ value: 'all', label: 'all fast' },
						{ value: '24h', label: '24h only' },
						{ value: 'off' }
					]}
					bind:value={network}
				/>
			</div>
			<div class="control">
				<span class="label">display</span>
				<Segmented
					label="coverage display"
					options={[{ value: 'gradient' }, { value: 'blackspots' }]}
					bind:value={mode}
				/>
			</div>
			<Slider
				label="blackspot threshold"
				min={10}
				max={40}
				bind:value={threshold}
				format={(v) => `${v} km`}
				disabled={network === 'off'}
			/>
			<Slider
				label="shading opacity"
				min={0.2}
				max={1}
				step={0.05}
				bind:value={opacity}
				format={(v) => `${Math.round(v * 100)}%`}
				disabled={network === 'off'}
			/>
			<Select label="basemap" options={BASEMAP_OPTIONS} bind:value={basemap} />

			<div class="group">
				<span class="label">chargers</span>
				<Toggle label="fast only" bind:checked={fastOnly} />
				<Toggle label="open 24 hours" bind:checked={only24h} />
				<Toggle label="no card or app" bind:checked={noCard} />
				<Toggle label="emp network" bind:checked={empOnly} />
				<PromptField placeholder="filter by name or address" bind:value={query} />
				<div class="note">
					{shown.length.toLocaleString('en')} of {chargers.length.toLocaleString('en')} sites<span
						class="sep">·</span
					><span class="fast">fast</span><span class="sep">·</span><span class="ac">ac only</span
					><span class="sep">·</span><span class="ringed">ringed</span> = 24h
				</div>
			</div>
		</div>
	</div>
</section>

<section>
	<SectionLabel index="02" label="Routes" descriptor="longest gap between fast chargers" />
	<div class="body">
		<p class="lede">
			Six touring routes, with every fast charger within 12 km of the route line. Gaps are measured
			along the line, so real road distance runs 15–25% higher on winding coast and mountain roads.
		</p>
		<BarChart
			label="longest gap between fast chargers by route"
			series={[
				{ key: 'all', label: 'all fast chargers', color: 'var(--color-series-1)' },
				{ key: 'h24', label: 'open 24h only', color: 'var(--color-series-2)' }
			]}
			rows={routes.map((r) => ({
				label: r.name,
				meta: `${r.km} km · ${r.n} fast chargers`,
				values: { all: r.gap, h24: r.gap24 },
				notes: { all: `after ${r.after}`, h24: `after ${r.after24} · ${r.n24} sites` }
			}))}
			max={200}
			ticks={[50, 100, 200]}
			unit=" km"
			reference={{ value: 150, label: '150 km range' }}
		/>
	</div>
</section>

<section>
	<SectionLabel index="03" label="Risks" descriptor="what actually constrains the trip" />
	<div class="risks">
		<article>
			<div class="risk-index">risk 01</div>
			<h2>The clock, not the map</h2>
			<p>
				133 of the {fast.length} fast chargers are car dealerships, and only 25 of those stay open 24
				hours. Most close between 17:00 and 18:00 and shut one weekday, often Tuesday or Wednesday.
			</p>
			<p>
				The northern coasts barely notice: they run on 道の駅 and convenience stores. The Shiretoko
				loop does. Drop the daytime-only sites and its worst gap widens from 67 km to 89 km, and the
				southern loop from 70 km to 95 km.
			</p>
		</article>
		<article>
			<div class="risk-index">risk 02</div>
			<h2>One charger, no backup</h2>
			<p>
				Rural sites almost always have a single stall. If it is occupied or broken, the next fast
				charger is typically 20–40 km away: fine at 60% charge, a real problem at 15%.
			</p>
			<p>
				Treat the network as roughly two-thirds reliable and keep a 40 km reserve rather than
				driving to the theoretical limit.
			</p>
		</article>
		<article>
			<div class="risk-index">risk 03</div>
			<h2>Power is unpublished</h2>
			<p>
				The source marks chargers 急速充電 but never states kW. Rural Hokkaido units are commonly
				20–44 kW, not the 90 kW of a Honshu expressway.
			</p>
			<p>
				On a 40 kWh battery a 44 kW unit is a 30-minute stop; a 20 kW unit is an hour. Budget stops
				by time, not kWh.
			</p>
		</article>
	</div>
</section>

<section class="caveats">
	<SectionLabel label="Caveats" />
	<p>
		Distances are straight-line, not driving distance. The source is compiled from public
		submissions and not guaranteed; confirm with the operator before relying on any site. Charger
		power is not recorded. Figures assume summer: in winter expect 30–40% less range, and several
		mountain passes close.
	</p>
</section>

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
		flex-wrap: wrap;
		gap: 18px;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.head p {
		max-width: 560px;
		font-size: var(--text-content);
		line-height: 1.7;
		color: var(--color-text-tertiary);
	}
	section + section {
		margin-top: 72px;
	}
	.head + section {
		margin-top: 56px;
	}
	.body {
		margin-top: 24px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.lede {
		max-width: 560px;
		font-size: var(--text-content);
		line-height: 1.7;
		color: var(--color-text-tertiary);
	}
	.note {
		font-size: var(--text-small);
		line-height: 1.7;
		color: var(--color-text-tertiary);
	}
	.sep {
		margin: 0 8px;
		color: var(--color-text-dim);
	}
	.fast {
		color: var(--color-accent);
	}
	.ac {
		color: var(--color-text-tertiary);
	}
	.ringed {
		color: var(--color-text);
	}

	/* ── explorer: map + controls ── */
	.explorer {
		margin-top: 24px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 48px;
		align-items: start;
	}
	.pane {
		display: flex;
		flex-direction: column;
		gap: 20px;
		min-width: 0;
	}
	.map {
		height: 640px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 24px;
		min-height: 20px;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.control,
	.group {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.group {
		gap: 16px;
	}
	.label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.spots {
		margin-top: 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.spots ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
		gap: 0 24px;
	}
	.spots button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: 8px 12px;
		margin-left: -12px;
		font: inherit;
		text-align: left;
		background: none;
		border: 0;
		cursor: pointer;
	}
	.area {
		font-size: var(--text-content);
		color: var(--color-text);
	}
	.detail {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	@media (hover: hover) {
		.spots button:hover {
			background: var(--color-lift);
		}
		.spots button:hover .area {
			color: var(--color-accent);
		}
	}

	/* ── risks ── */
	.risks {
		margin-top: 24px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
		gap: 40px 48px;
	}
	.risk-index {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-accent);
	}
	.risks h2 {
		margin: 12px 0 14px;
		font-size: var(--text-title);
		font-weight: 600;
		color: var(--color-text);
	}
	.risks p {
		font-size: var(--text-body);
		line-height: 1.75;
		color: var(--color-text-secondary);
	}
	.risks p + p {
		margin-top: 12px;
	}

	/* ── caveats ── */
	.caveats p {
		margin-top: 20px;
		max-width: 720px;
		font-size: var(--text-small);
		line-height: 1.75;
		color: var(--color-text-faint);
	}

	@media (max-width: 959px) {
		.explorer {
			grid-template-columns: 1fr;
		}
		.panel {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr));
			gap: 32px 48px;
		}
	}
	@media (max-width: 719px) {
		.head {
			padding-top: 48px;
		}
		.map {
			height: 440px;
		}
	}
</style>
