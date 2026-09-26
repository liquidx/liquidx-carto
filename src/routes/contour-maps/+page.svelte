<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import AreaMap from '$lib/components/AreaMap.svelte';
	import Button from '$lib/components/Button.svelte';
	import ContourPreview from '$lib/components/ContourPreview.svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import PlaceSearch from '$lib/components/PlaceSearch.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Select from '$lib/components/Select.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { DemStore } from '$lib/dem/store.svelte';
	import {
		autoInterval as pickInterval,
		gridStats,
		NICE_INTERVALS,
		type ContourOptions,
		type Grid,
		type GridStats
	} from '$lib/contour/contour';
	import { sampleDemGrid } from '$lib/contour/dem-grid';
	import {
		boxSizeMetres,
		frameAt,
		frameBox,
		latToY,
		lonToX,
		metresPerUnit,
		xToLon,
		yToLat,
		type Frame
	} from '$lib/contour/mercator';
	import { encodeBmp, encodeBmp1, encodeTiff, hexToRgb } from '$lib/contour/raster-encode';
	import type { Place } from '$lib/contour/geocode';
	import { DEFAULT_STYLE, findStyle, STYLES } from '$lib/contour/styles';
	import { BASEMAP_OPTIONS, type BasemapId } from '$lib/contour/basemaps';
	import { findProvider, PROVIDERS, sampleApiGrid } from '$lib/contour/terrain-api';
	import { ContourTracer } from '$lib/contour/tracer';
	import type { ContourPath } from '$lib/contour/worker';

	let { data } = $props();

	const dem = new DemStore();
	const tracer = new ContourTracer();

	type Source = 'files' | 'api';
	type Detail = 'coarse' | 'normal' | 'fine';
	const DETAIL: Record<Detail, number> = { coarse: 0.5, normal: 1, fine: 2 };
	/** More levels than this is almost certainly a mistake (and slow). */
	const MAX_LEVELS = 600;

	let source = $state<Source>('api');
	let providerId = $state(PROVIDERS[0].id);
	let styleId = $state(DEFAULT_STYLE);
	let outWidth = $state(800);
	let outHeight = $state(480);
	let detail = $state<Detail>('normal');
	let intervalIndex = $state(NICE_INTERVALS.indexOf(20));
	let autoInterval = $state(true);
	let majorEvery = $state(5);
	let smoothing = $state(1.5);
	/** Index contour stroke width in output px; overrides the style's default. */
	let majorWidth = $state(findStyle(DEFAULT_STYLE).majorWidth);
	let seaFloor = $state(false);
	// Mount Fuji: a recognisable default with plenty of relief.
	let frame = $state<Frame | null>(frameAt(138.7274, 35.3606, 18_000));
	let drawing = $state(false);
	let basemap = $state<BasemapId>('terrain');

	let map: AreaMap | undefined = $state();
	let svg: SVGSVGElement | undefined = $state();

	const aspect = $derived(outWidth / outHeight);
	const interval = $derived(NICE_INTERVALS[intervalIndex]);
	const box = $derived(frame ? frameBox(frame, aspect) : null);
	const provider = $derived(findProvider(providerId));
	const style = $derived({ ...findStyle(styleId), majorWidth });

	interface Sampled {
		grid: Grid;
		stats: GridStats;
		outWidth: number;
		outHeight: number;
		/** Source resolution in metres per sample. */
		resolution: number;
	}

	let sampled = $state.raw<Sampled | null>(null);
	let paths = $state.raw<ContourPath[]>([]);
	let status = $state<'idle' | 'sampling' | 'tracing' | 'ready' | 'error'>('idle');
	let message = $state('');
	let traceMs = $state(0);

	// ── data ────────────────────────────────────────────

	let samples = $state<{ path: string; url: string }[]>([]);
	onMount(() => {
		if (data.dev) {
			fetch('/api/sample')
				.then((r) => (r.ok ? r.json() : { files: [] }))
				.then((j) => (samples = j.files))
				.catch(() => {});
		}
		return () => tracer.terminate();
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

	/** Frame the middle of the loaded data. */
	function frameToBounds() {
		const b = dem.bounds;
		if (!b) return;
		const x0 = lonToX(b.west),
			x1 = lonToX(b.east),
			y0 = latToY(b.north),
			y1 = latToY(b.south);
		const w = Math.min(x1 - x0, (y1 - y0) * aspect) * 0.8;
		frame = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w };
	}

	function demResolution(lat: number) {
		const t = dem.tiles[0];
		const tile = t && dem.data.get(t.id);
		if (!tile) return 0;
		return (((tile.east - tile.west) / tile.width) * metresPerUnit(lat)) / 360;
	}

	// ── place search ────────────────────────────────────

	/** Centre the frame on a place, keeping its ground size, and bring it into view. */
	async function goTo(place: Place) {
		// Keep the ground width: mercator units shrink or grow with latitude.
		const ground = frame ? frame.w * metresPerUnit(yToLat(frame.cy)) : 18_000;
		frame = frameAt(place.lon, place.lat, ground);
		await tick();
		map?.showFrame();
	}

	// ── sampling: frame / size / source → elevation grid ─

	let sampleGen = 0;
	$effect(() => {
		const b = box;
		const w = outWidth;
		const h = outHeight;
		const d = DETAIL[detail];
		const src = source;
		const p = provider;
		const version = dem.version;
		const tileCount = dem.tiles.length;
		const busy = dem.loading > 0;
		void version;
		if (!b || !(w > 1 && h > 1)) return;
		if (src === 'files' && (busy || !tileCount)) return;

		const gen = ++sampleGen;
		status = 'sampling';
		message = '';
		const timer = setTimeout(async () => {
			try {
				const gw = Math.max(2, Math.round(w * d));
				const gh = Math.max(2, Math.round(h * d));
				let grid: Grid;
				let resolution: number;
				if (src === 'api') {
					const r = await sampleApiGrid(p, b, gw, gh);
					grid = r.grid;
					resolution = r.resolution;
				} else {
					resolution = demResolution(yToLat((b.y0 + b.y1) / 2));
					// Box-filter fine data: up to 6 × 6 samples per grid cell.
					const spacing = boxSizeMetres(b).width / (gw - 1);
					const supersample = Math.min(6, Math.max(1, Math.round(spacing / resolution)));
					grid = sampleDemGrid(dem.sampler(), b, gw, gh, supersample);
				}
				if (gen !== sampleGen) return;
				sampled = { grid, stats: gridStats(grid), outWidth: w, outHeight: h, resolution };
			} catch (e) {
				if (gen !== sampleGen) return;
				status = 'error';
				message = (e as Error).message;
			}
		}, 250);
		return () => clearTimeout(timer);
	});

	// Auto interval: ~40 contours over the relief shown.
	$effect(() => {
		if (!autoInterval || !sampled) return;
		const { min, max } = sampled.stats;
		const lo = seaFloor ? min : Math.max(0, min);
		intervalIndex = NICE_INTERVALS.indexOf(pickInterval(Math.max(0, max - lo)));
	});

	// ── tracing: grid + contour options → paths ─────────

	const levelCount = $derived.by(() => {
		if (!sampled) return 0;
		const { min, max } = sampled.stats;
		const lo = seaFloor ? min : Math.max(0, min);
		return Math.max(0, Math.floor(max / interval) - Math.floor(lo / interval));
	});

	$effect(() => {
		const s = sampled;
		if (!s) return;
		if (levelCount > MAX_LEVELS) {
			status = 'error';
			message = `${levelCount} contours at ${interval} m: pick a larger interval`;
			return;
		}
		const cellsPerPx = (s.grid.width - 1) / s.outWidth;
		const opts: ContourOptions = {
			interval,
			majorEvery,
			smoothing: smoothing * cellsPerPx,
			outWidth: s.outWidth,
			outHeight: s.outHeight,
			skipBelowSea: !seaFloor,
			tolerance: 0.15
		};
		status = 'tracing';
		const timer = setTimeout(async () => {
			try {
				const r = await tracer.trace(s.grid, opts);
				if (!r) return;
				paths = r.paths;
				traceMs = r.ms;
				if (untrack(() => sampled) === s) status = 'ready';
			} catch (e) {
				status = 'error';
				message = (e as Error).message;
			}
		}, 40);
		return () => clearTimeout(timer);
	});

	// ── export ──────────────────────────────────────────

	function filename(ext: string) {
		if (!frame) return `contours.${ext}`;
		const lat = yToLat(frame.cy).toFixed(4);
		const lon = xToLon(frame.cx).toFixed(4);
		return `contours_${lat}_${lon}_${interval}m.${ext}`;
	}

	function download(blob: Blob, name: string) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	/** The preview as a standalone SVG file. `minStroke` thickens any thinner lines (in output px). */
	function svgBlob(minStroke = 0) {
		// Drop Svelte's scoped class names so the file is plain SVG.
		const clone = svg!.cloneNode(true) as SVGSVGElement;
		for (const el of [clone, ...clone.querySelectorAll('*')]) el.removeAttribute('class');
		if (minStroke > 0) {
			for (const el of clone.querySelectorAll('[stroke-width]')) {
				const w = Number(el.getAttribute('stroke-width'));
				if (w < minStroke) el.setAttribute('stroke-width', String(minStroke));
			}
		}
		const text = new XMLSerializer().serializeToString(clone);
		return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${text}`], {
			type: 'image/svg+xml'
		});
	}

	type Format = 'svg' | 'png' | 'bmp' | 'tiff';
	let exportFormat = $state<Format>('svg');
	let exportScale = $state<'1x' | '2x'>('1x');
	/** BMP only: full colour, or 1-bit using the style's background and ink as the palette. */
	let bmpDepth = $state<'normal' | '1-bit'>('normal');
	let exporting = $state(false);

	/** Rasterise the preview SVG at `scale` × the output size. */
	async function rasterise(scale: number, minStroke = 0): Promise<HTMLCanvasElement> {
		const url = URL.createObjectURL(svgBlob(minStroke));
		try {
			const img = new Image();
			img.src = url;
			await img.decode();
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(sampled!.outWidth * scale);
			canvas.height = Math.round(sampled!.outHeight * scale);
			canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
			return canvas;
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	async function exportMap() {
		if (!svg || !sampled) return;
		if (exportFormat === 'svg') return download(svgBlob(), filename('svg'));
		exporting = true;
		try {
			const scale = exportScale === '2x' ? 2 : 1;
			const oneBit = exportFormat === 'bmp' && bmpDepth === '1-bit';
			// Hairlines anti-alias to partial-coverage greys that break up when thresholded to
			// 1 bit, so draw every line at least one device pixel wide first.
			const canvas = await rasterise(scale, oneBit ? 1 / scale : 0);
			// 72 dpi at 1×, so a 2× export prints at the same physical size.
			const dpi = 72 * scale;
			let blob: Blob | null;
			if (exportFormat === 'png') {
				blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
			} else {
				const { width, height } = canvas;
				const pixels = {
					width,
					height,
					data: canvas.getContext('2d')!.getImageData(0, 0, width, height).data
				};
				const bytes =
					exportFormat === 'tiff'
						? encodeTiff(pixels, dpi)
						: oneBit
							? encodeBmp1(pixels, hexToRgb(style.background), hexToRgb(style.ink), dpi)
							: encodeBmp(pixels, dpi);
				blob = new Blob([bytes], { type: exportFormat === 'tiff' ? 'image/tiff' : 'image/bmp' });
			}
			let ext = exportFormat === 'tiff' ? 'tif' : exportFormat;
			if (oneBit) ext = `1bit.${ext}`;
			if (blob) download(blob, filename(scale === 1 ? ext : `${scale}x.${ext}`));
		} finally {
			exporting = false;
		}
	}

	// ── readouts ────────────────────────────────────────

	const fmtKm = (m: number) =>
		m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km` : `${Math.round(m)} m`;
	const fmtM = (m: number) => `${Math.round(m).toLocaleString('en')} m`;

	const frameInfo = $derived.by(() => {
		if (!frame || !box) return null;
		const size = boxSizeMetres(box);
		const lat = yToLat(frame.cy);
		const lon = xToLon(frame.cx);
		return {
			centre: `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'n' : 's'} · ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'e' : 'w'}`,
			size: `${fmtKm(size.width)} × ${fmtKm(size.height)}`,
			scale: `${(size.width / outWidth).toFixed(1)} m/px`
		};
	});
</script>

<svelte:head><title>Contour Maps · Carto</title></svelte:head>

<section class="head">
	<h1>Contour Maps</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
	</div>
	<p>
		Trace contour lines from elevation data. Load your own DEM files or pull terrain tiles, frame an
		area on the map, and export the result as SVG, PNG, BMP or TIFF.
	</p>
</section>

<section>
	<SectionLabel index="01" label="Source" />
	<div class="body source">
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

<section>
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
				{aspect}
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
				{drawing ? 'drawing…' : 'draw frame'}
			</Button>
			<Button size="sm" onclick={() => map?.showFrame()} disabled={!frame}>show frame</Button>
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
			{#if frameInfo}
				<span class="note readout">
					{frameInfo.centre}<span class="sep">·</span>{frameInfo.size}<span class="sep">·</span
					>{frameInfo.scale}
				</span>
			{/if}
		</div>
	</div>
</section>

<section>
	<SectionLabel index="03" label="Contours" />
	<div class="body controls">
		<div class="control">
			<Slider
				label="interval"
				min={0}
				max={NICE_INTERVALS.length - 1}
				step={1}
				bind:value={intervalIndex}
				format={(i) => `${NICE_INTERVALS[i]} m`}
				oninput={() => (autoInterval = false)}
			/>
			<Toggle label="auto" bind:checked={autoInterval} />
		</div>
		<Slider
			label="index contour"
			min={0}
			max={10}
			bind:value={majorEvery}
			format={(v) => (v ? `every ${v}` : 'off')}
		/>
		<Slider
			label="index weight"
			min={0.5}
			max={4}
			step={0.1}
			bind:value={majorWidth}
			format={(v) => `${v.toFixed(1)} px`}
			disabled={!majorEvery}
		/>
		<Slider
			label="smoothing"
			min={0}
			max={5}
			step={0.25}
			bind:value={smoothing}
			format={(v) => (v ? `${v.toFixed(2)} px` : 'off')}
		/>
		<div class="control">
			<span class="label">grid</span>
			<Segmented
				label="grid resolution"
				options={[{ value: 'coarse' }, { value: 'normal' }, { value: 'fine' }]}
				bind:value={detail}
			/>
		</div>
		<div class="size">
			<NumberField label="width" unit="px" min={100} max={6000} bind:value={outWidth} />
			<NumberField label="height" unit="px" min={100} max={6000} bind:value={outHeight} />
		</div>
		<div class="control">
			<span class="label">style</span>
			<Segmented
				label="style"
				options={STYLES.map((s) => ({ value: s.id, label: s.label }))}
				bind:value={styleId}
			/>
		</div>
		<div class="control">
			<Toggle label="sea floor contours" bind:checked={seaFloor} />
		</div>
	</div>
</section>

<section>
	<SectionLabel
		index="04"
		label="Preview"
		count={sampled ? `${sampled.outWidth} × ${sampled.outHeight}` : undefined}
	/>
	<div class="body">
		<div class="preview" class:stale={status === 'sampling' || status === 'tracing'}>
			{#if sampled}
				<ContourPreview
					bind:svg
					{paths}
					{style}
					width={sampled.outWidth}
					height={sampled.outHeight}
				/>
			{:else}
				<div
					class="placeholder"
					style:aspect-ratio="{outWidth} / {outHeight}"
					style:max-width="{outWidth}px"
				>
					{source === 'files' && !dem.tiles.length ? 'load dem files to begin' : ''}
				</div>
			{/if}
		</div>
		{#if message}<div class="error">{message}</div>{/if}
		<div class="row">
			<div class="format">
				<Segmented
					label="export format"
					options={[{ value: 'svg' }, { value: 'png' }, { value: 'bmp' }, { value: 'tiff' }]}
					bind:value={exportFormat}
				/>
			</div>
			<div class="scale" class:hidden={exportFormat === 'svg'}>
				<Segmented
					label="export scale"
					options={[{ value: '1x' }, { value: '2x' }]}
					bind:value={exportScale}
				/>
			</div>
			{#if exportFormat === 'bmp'}
				<div class="depth">
					<Segmented
						label="bmp colour depth"
						options={[{ value: 'normal' }, { value: '1-bit' }]}
						bind:value={bmpDepth}
					/>
				</div>
			{/if}
			<Button variant="primary" onclick={exportMap} disabled={!sampled || exporting}>
				{exporting ? 'exporting…' : 'export'}
			</Button>
			{#if sampled}
				<span class="note readout">
					{fmtM(sampled.stats.min)} – {fmtM(sampled.stats.max)}<span class="sep">·</span
					>{paths.length} contours at {interval} m<span class="sep">·</span>source ~{sampled.resolution <
					10
						? sampled.resolution.toFixed(1)
						: Math.round(sampled.resolution)} m{#if sampled.stats.nodata > 0.001}<span class="sep"
							>·</span
						><span class="warn">{(sampled.stats.nodata * 100).toFixed(1)}% no data</span>{/if}
					{#if status === 'ready'}<span class="sep">·</span>{Math.round(traceMs)} ms{/if}
				</span>
			{/if}
		</div>
	</div>
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
		gap: 12px 12px;
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
	.controls {
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
	.size {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.format {
		width: 240px;
	}
	.scale {
		width: 110px;
	}
	.depth {
		width: 150px;
	}
	/* Keep the row from reflowing when svg (which has no scale) is picked. */
	.scale.hidden {
		visibility: hidden;
	}
	.preview {
		transition: opacity 0.2s;
	}
	.preview.stale {
		opacity: 0.6;
	}
	.placeholder {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface);
		font-size: var(--text-small);
		color: var(--color-text-faint);
	}
	@media (max-width: 719px) {
		.head {
			padding-top: 48px;
		}
		.map {
			height: 360px;
		}
		.provider {
			grid-template-columns: 1fr;
		}
		.readout {
			margin-left: 0;
		}
	}
</style>
