<script lang="ts">
	import { onMount } from 'svelte';
	import AreaMap from '$lib/components/AreaMap.svelte';
	import Button from '$lib/components/Button.svelte';
	import DataCredits from '$lib/components/DataCredits.svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import PlaceSearch from '$lib/components/PlaceSearch.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Select from '$lib/components/Select.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { DemStore } from '$lib/dem/store.svelte';
	import { BASEMAP_OPTIONS, type BasemapId } from '$lib/map/basemaps';
	import type { Place } from '$lib/contour/geocode';
	import {
		frameAt,
		frameBox,
		latToY,
		lonToX,
		metresPerUnit,
		xToLon,
		yToLat,
		type Frame
	} from '$lib/contour/mercator';
	import { findProvider, PROVIDERS, sampleApiGrid } from '$lib/contour/terrain-api';
	import {
		Compass,
		Diorama,
		buildDiorama,
		type Circle,
		type DioramaData,
		type MeshParams,
		type Sampler,
		type TerrainPreset
	} from '@liquidx/diorama';
	import { gridSampler } from '$lib/diorama/sampler';

	import { TERRAIN_TOOL_CREDITS } from '$lib/credits';

	let { data } = $props();

	const dem = new DemStore();

	type Source = 'files' | 'api';
	// Terrain tiles are sampled on a grid of at most 1024², two samples per ring, so more rings
	// than this add triangles without adding detail.
	const MAX_RINGS = 512;

	let source = $state<Source>('api');
	let providerId = $state(PROVIDERS[0].id);
	let basemap = $state<BasemapId>('terrain');
	// Mount Fuji: a recognisable default with plenty of relief. The frame is the circle's square.
	let frame = $state<Frame | null>(frameAt(138.7274, 35.3606, 14_000));
	let drawing = $state(false);
	/** Mesh detail: rings from the centre to the rim, so the ground spacing is radius / rings. */
	let rings = $state(224);
	let wireframe = $state(false);
	let exaggeration = $state(1);
	let baseDepth = $state(0.25);
	let contourInterval = $state(50);
	let majorEvery = $state(5);
	let terrain = $state<TerrainPreset>('topo');
	let autoRotate = $state(true);
	let rotateSpeed = $state(1.2);

	let map: AreaMap | undefined = $state();
	let view: Diorama | undefined = $state();

	const provider = $derived(findProvider(providerId));
	const meshParams = $derived<MeshParams>({ rings });
	const circle = $derived.by((): Circle | null => {
		if (!frame) return null;
		const lat = yToLat(frame.cy);
		return { lon: xToLon(frame.cx), lat, radius: (frame.w / 2) * metresPerUnit(lat) };
	});

	let model = $state.raw<DioramaData | null>(null);
	/** Source resolution in metres per sample, for the readout. */
	let resolution = $state(0);
	let status = $state<'idle' | 'building' | 'ready' | 'error'>('idle');
	let message = $state('');

	// ── data ────────────────────────────────────────────

	let samples = $state<{ path: string; url: string }[]>([]);
	onMount(() => {
		if (!data.dev) return;
		fetch('/api/sample')
			.then((r) => (r.ok ? r.json() : { files: [] }))
			.then((j) => (samples = j.files))
			.catch(() => {});
	});

	const isDem = (name: string) => /\.(xml|zip)$/i.test(name);

	async function loadDem(sources: { source: File | string; name: string }[]) {
		const first = dem.tiles.length === 0;
		source = 'files';
		await dem.load(sources);
		if (first && dem.bounds) {
			frameToBounds();
			map?.fitBounds(dem.bounds);
		}
	}

	/** A circle in the middle of the loaded data. */
	function frameToBounds() {
		const b = dem.bounds;
		if (!b) return;
		const x0 = lonToX(b.west),
			x1 = lonToX(b.east),
			y0 = latToY(b.north),
			y1 = latToY(b.south);
		frame = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.min(x1 - x0, y1 - y0) * 0.8 };
	}

	function demResolution(lat: number) {
		const t = dem.tiles[0];
		const tile = t && dem.data.get(t.id);
		if (!tile) return 0;
		return (((tile.east - tile.west) / tile.width) * metresPerUnit(lat)) / 360;
	}

	/** Centre the circle on a place, keeping its ground size. */
	function goTo(place: Place) {
		const ground = circle ? circle.radius * 2 : 14_000;
		frame = frameAt(place.lon, place.lat, ground);
		map?.showFrame();
	}

	// ── build: circle / source / mesh → model ───────────

	let buildGen = 0;
	$effect(() => {
		const f = frame;
		const c = circle;
		const src = source;
		const p = provider;
		const params = meshParams;
		const version = dem.version;
		const tileCount = dem.tiles.length;
		const busy = dem.loading > 0;
		void version;
		if (!f || !c) return;
		if (src === 'files' && !tileCount) {
			if (!busy) {
				model = null;
				status = 'idle';
			}
			return;
		}
		if (src === 'files' && busy) return;

		const gen = ++buildGen;
		status = 'building';
		message = '';
		const timer = setTimeout(async () => {
			try {
				let sample: Sampler;
				let res: number;
				if (src === 'api') {
					// A little margin so the rim never samples outside the grid.
					const box = frameBox({ ...f, w: f.w * 1.04 }, 1);
					const n = Math.min(1024, params.rings * 2 + 1);
					const r = await sampleApiGrid(p, box, n, n);
					sample = gridSampler(r.grid, box);
					res = r.resolution;
				} else {
					sample = dem.sampler();
					res = demResolution(c.lat);
				}
				if (gen !== buildGen) return;
				const next = buildDiorama(sample, c, params);
				if (gen !== buildGen) return next.geometry.dispose();
				model = next;
				resolution = res;
				status = 'ready';
			} catch (e) {
				if (gen !== buildGen) return;
				status = 'error';
				message = (e as Error).message;
			}
		}, 300);
		return () => clearTimeout(timer);
	});

	// ── export ──────────────────────────────────────────

	let exporting = $state(false);

	async function exportGlb() {
		if (!view || !circle) return;
		exporting = true;
		try {
			const blob = await view.glb();
			if (!blob) return;
			const name = `diorama_${circle.lat.toFixed(4)}_${circle.lon.toFixed(4)}_${Math.round(circle.radius)}m.glb`;
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		} finally {
			exporting = false;
		}
	}

	// ── readouts ────────────────────────────────────────

	const fmtKm = (m: number) =>
		m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km` : `${Math.round(m)} m`;
	const fmtM = (m: number) => `${Math.round(m).toLocaleString('en')} m`;
	/** Ground distance between rings, the mesh's nominal resolution. */
	const fmtSpacing = (m: number) => (m < 10 ? `${m.toFixed(1)} m` : fmtKm(m));
	const fmtCount = (n: number) =>
		n >= 1e6 ? `${(n / 1e6).toFixed(2)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

	const circleInfo = $derived.by(() => {
		if (!circle) return null;
		const { lat, lon, radius } = circle;
		return {
			centre: `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'n' : 's'} · ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'e' : 'w'}`,
			diameter: `⌀ ${fmtKm(radius * 2)}`
		};
	});

	const hint = $derived(
		source === 'files' && !dem.tiles.length
			? 'load dem files to begin'
			: status === 'error'
				? ''
				: 'building…'
	);
</script>

<svelte:head><title>Mountain Diorama · Carto</title></svelte:head>

<section class="head">
	<h1>Mountain Diorama</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
	</div>
	<p>
		Cut a circular core of terrain out of elevation data and extrude it into a 3D diorama. Pick an
		area on the map, tune the relief and contours, and export the model as GLB.
	</p>
</section>

<section>
	<SectionLabel index="01" label="Source" />
	<div class="body">
		<div class="source-switch">
			<Segmented
				label="elevation source"
				options={[
					{ value: 'files', label: 'dem files', count: dem.tiles.length || undefined },
					{ value: 'api', label: 'terrain tiles' }
				]}
				bind:value={source}
			/>
		</div>

		{#if source === 'files'}
			<DropZone
				onfiles={(files) => loadDem(files.map((f) => ({ source: f, name: f.name })))}
				accept={isDem}
				extensions=".xml,.zip"
				title="drop dem files or folders"
				hint="gsi 基盤地図情報 fgd gml (.xml) or the .zip archives it comes in"
			/>
			<div class="row">
				{#if samples.length}
					<Button
						size="sm"
						onclick={() =>
							loadDem(samples.map((s) => ({ source: s.url, name: s.path.split('/').pop()! })))}
					>
						load sample · {samples.length} files
					</Button>
				{/if}
				<span class="note">
					{#if dem.loading > 0}
						parsing {dem.loading} file{dem.loading === 1 ? '' : 's'}…
					{:else if dem.tiles.length}
						{dem.tiles.length} tiles · {fmtM(dem.minZ)} – {fmtM(dem.maxZ)}
					{:else}
						no tiles loaded
					{/if}
				</span>
				{#if dem.tiles.length}
					<Button size="sm" variant="danger" onclick={() => dem.clear()}>clear</Button>
				{/if}
			</div>
			{#each dem.errors as err (err)}
				<div class="error">{err}</div>
			{/each}
		{:else}
			<div class="provider">
				<Select
					label="provider"
					options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
					bind:value={providerId}
				/>
				<div class="note">
					{provider.coverage}<br />
					<span class="faint">{provider.attribution}</span>
				</div>
			</div>
		{/if}
	</div>
</section>

<div class="workspace">
	<section class="area">
		<SectionLabel index="02" label="Area" />
		<div class="body">
			<div class="map-bar">
				<div class="search">
					<PlaceSearch onselect={goTo} />
				</div>
				<div class="basemap">
					<Segmented label="basemap" options={BASEMAP_OPTIONS} bind:value={basemap} />
				</div>
			</div>
			<div class="map">
				<AreaMap
					bind:this={map}
					bind:frame
					bind:drawing
					shape="circle"
					demTiles={source === 'files' ? dem.tiles : []}
					terrain={source === 'api'}
					{basemap}
				/>
			</div>
			<div class="row">
				<Button
					size="sm"
					variant={drawing ? 'primary' : 'neutral'}
					onclick={() => (drawing = !drawing)}
				>
					{drawing ? 'drawing…' : 'draw circle'}
				</Button>
				<Button size="sm" onclick={() => map?.showFrame()} disabled={!frame}>show circle</Button>
				{#if source === 'files' && dem.bounds}
					<Button
						size="sm"
						onclick={() => {
							frameToBounds();
							map?.fitBounds(dem.bounds!);
						}}
					>
						fit to data
					</Button>
				{/if}
				{#if circleInfo}
					<span class="note readout">
						{circleInfo.centre}<span class="sep">·</span>{circleInfo.diameter}
					</span>
				{/if}
			</div>
			<div class="radius">
				<NumberField
					label="radius"
					unit="m"
					min={50}
					max={50_000}
					step={10}
					bind:value={
						() => Math.round(circle?.radius ?? 0),
						(r) => {
							if (frame) frame = { ...frame, w: (2 * r) / metresPerUnit(yToLat(frame.cy)) };
						}
					}
				/>
			</div>
		</div>
	</section>

	<section class="model">
		<SectionLabel
			index="03"
			label="Diorama"
			count={model ? `${fmtCount((model.geometry.index?.count ?? 0) / 3)} triangles` : undefined}
		/>
		<div class="body">
			<div class="stage" class:stale={status === 'building'}>
				<Diorama
					bind:this={view}
					data={model}
					{exaggeration}
					{baseDepth}
					{contourInterval}
					{majorEvery}
					{terrain}
					{autoRotate}
					{rotateSpeed}
					{wireframe}
				>
					<Compass />
				</Diorama>
				{#if !model && hint}<div class="hint">{hint}</div>{/if}
			</div>
			{#if message}<div class="error">{message}</div>{/if}
			<div class="controls">
				<Slider
					label="vertical exaggeration"
					min={0.25}
					max={4}
					step={0.05}
					bind:value={exaggeration}
					format={(v) => `${v.toFixed(2)}×`}
				/>
				<Slider
					label="base thickness"
					min={0.02}
					max={1}
					step={0.01}
					bind:value={baseDepth}
					format={(v) => `${v.toFixed(2)} r`}
				/>
				<Slider
					label="contour interval"
					min={0}
					max={200}
					step={5}
					bind:value={contourInterval}
					format={(v) => (v ? `${v} m` : 'off')}
				/>
				<Slider
					label="index contour"
					min={0}
					max={10}
					bind:value={majorEvery}
					format={(v) => (v ? `every ${v}` : 'off')}
					disabled={!contourInterval}
				/>
				<div class="control">
					<span class="label">style</span>
					<Segmented
						label="terrain style"
						options={[{ value: 'topo' }, { value: 'snow' }]}
						bind:value={terrain}
					/>
				</div>
				<div class="control">
					<Slider
						label="mesh detail"
						min={16}
						max={MAX_RINGS}
						step={8}
						bind:value={rings}
						format={(v) =>
							circle ? `${v} rings · ${fmtSpacing(circle.radius / v)}` : `${v} rings`}
					/>
					<Toggle label="wireframe" bind:checked={wireframe} />
				</div>
				<div class="control">
					<Slider
						label="rotation speed"
						min={0.2}
						max={6}
						step={0.1}
						bind:value={rotateSpeed}
						format={(v) => v.toFixed(1)}
						disabled={!autoRotate}
					/>
					<Toggle label="auto-rotate" bind:checked={autoRotate} />
				</div>
			</div>
			<div class="row">
				<Button variant="primary" onclick={exportGlb} disabled={!model || exporting}>
					{exporting ? 'exporting…' : 'export glb'}
				</Button>
				{#if model}
					<span class="note readout">
						{fmtM(model.minZ)} – {fmtM(model.maxZ)}{#if resolution}<span class="sep">·</span>source
							~{resolution < 10 ? resolution.toFixed(1) : Math.round(resolution)} m{/if}{#if model.nodataFraction > 0.001}<span
								class="sep">·</span
							><span class="warn">{(model.nodataFraction * 100).toFixed(1)}% no data</span>{/if}
					</span>
				{/if}
			</div>
		</div>
	</section>
</div>

<DataCredits credits={TERRAIN_TOOL_CREDITS} />

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
		gap: 20px;
	}
	.source-switch {
		max-width: 360px;
	}
	.provider {
		display: grid;
		grid-template-columns: minmax(0, 280px) 1fr;
		gap: 24px;
		align-items: end;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}
	.note {
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
		line-height: 1.7;
	}
	.readout {
		margin-left: 8px;
	}
	.sep {
		margin: 0 8px;
		color: var(--color-text-dim);
	}
	.faint {
		color: var(--color-text-faint);
	}
	.warn {
		color: var(--color-warn);
	}
	.error {
		font-size: var(--text-small);
		color: var(--color-danger);
	}
	.map-bar {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px 32px;
	}
	.basemap {
		width: 420px;
		max-width: 100%;
	}
	.search {
		flex: 1 1 320px;
		max-width: 560px;
	}
	.map {
		height: 480px;
	}
	.workspace {
		margin-top: 72px;
	}
	.radius {
		width: 200px;
	}
	.stage {
		position: relative;
		height: 560px;
		transition: opacity 0.2s;
		--diorama-background: var(--color-surface);
	}
	.hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--spacing-gutter);
		text-align: center;
		font-size: var(--text-small);
		color: var(--color-text-faint);
		pointer-events: none;
	}
	.stage.stale {
		opacity: 0.6;
	}
	.controls {
		margin-top: 16px;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr));
		gap: 36px 48px;
	}
	.control {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 10px;
	}
	.control .label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	/* Wide: map and model side by side, their panes top-aligned and the same height. */
	@media (min-width: 960px) {
		.workspace {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0 48px;
			align-items: start;
		}
		.workspace section + section {
			margin-top: 0;
		}
		/* Map first, so it lines up with the model; its buttons stay right under it. */
		.area .map,
		.area .row {
			order: -1;
		}
		.map,
		.stage {
			height: 520px;
		}
		.basemap {
			width: 100%;
		}
		.controls {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 32px 36px;
		}
	}
	@media (max-width: 719px) {
		.head {
			padding-top: 48px;
		}
		.map {
			height: 360px;
		}
		.stage {
			height: 400px;
		}
		.provider {
			grid-template-columns: 1fr;
		}
		.readout {
			margin-left: 0;
		}
	}
</style>
