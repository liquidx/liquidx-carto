<script lang="ts">
	import { onDestroy } from 'svelte';
	import { asset } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import ColorField from '$lib/components/ColorField.svelte';
	import DataCredits from '$lib/components/DataCredits.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import PromptField from '$lib/components/PromptField.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Select from '$lib/components/Select.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { ContourTracer } from '$lib/contour/tracer';
	import { CREDITS } from '$lib/credits';
	import { decodeDem, reliefImage } from '$lib/tokyo-outline/dem';
	import demMeta from '$lib/tokyo-outline/dem.json';
	import tokyo from '$lib/tokyo-outline/outline.json';
	import { PALETTES } from '$lib/tokyo-outline/palettes';

	let { data } = $props();

	/** The canvas is this wide in its own units, whatever its shape; stroke widths share them. */
	const WIDTH = 1000;

	// ── settings ────────────────────────────────────────

	const STORAGE_KEY = 'carto:tokyo-outline';

	/** Every control's value as last left in this browser; empty on a first visit. */
	const stored: Record<string, unknown> = (() => {
		try {
			return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
		} catch {
			// Unreadable, or storage is blocked: start from the defaults.
			return {};
		}
	})();

	/** A stored setting, if it is still the kind of value its control expects. */
	function saved<T>(key: string, fallback: T): T {
		const value = stored[key];
		if (Array.isArray(fallback))
			return Array.isArray(value) && value.length && value.every((v) => typeof v === 'string')
				? (value as T)
				: fallback;
		return typeof value === typeof fallback ? (value as T) : fallback;
	}

	function resetSettings() {
		localStorage.removeItem(STORAGE_KEY);
		location.reload();
	}

	let aspect = $state<'1:1' | '16:9'>(saved('aspect', '1:1'));
	const HEIGHT = $derived(aspect === '16:9' ? (WIDTH * 9) / 16 : WIDTH);

	let outlineWidth = $state(saved('outlineWidth', 3));
	let borderWidth = $state(saved('borderWidth', 1));
	let margin = $state(saved('margin', 8));
	let jitter = $state(saved('jitter', 0));
	let islands = $state(saved('islands', false));
	/** Reseeds the palette assignment, the jitter and the stacking order together. */
	let seed = $state(saved('seed', 1));

	let fill = $state<'single' | 'palette'>(saved('fill', 'single'));
	/** A preset's id, or `custom` once its colours have been edited. */
	let palette = $state(saved('palette', PALETTES[0].id));
	/** The palette in use, any number of colours. */
	let colors = $state(saved('colors', [...PALETTES[0].colors]));
	/** The same palette as typed: hex codes, kept as written while it's being edited. */
	let hexes = $state(saved('hexes', PALETTES[0].colors.join(' ')));

	function usePreset(id: string) {
		const preset = PALETTES.find((p) => p.id === id);
		if (!preset) return;
		colors = [...preset.colors];
		hexes = colors.join(' ');
	}

	/** Every hex code in the text, with or without `#`, however they're separated. */
	function typePalette(text: string) {
		hexes = text;
		const found = text
			.split(/[^0-9a-f]+/i)
			.filter((h) => h.length === 3 || h.length === 6)
			// a colour input only takes the six-digit form
			.map((h) => '#' + (h.length === 3 ? h.replace(/./g, '$&$&') : h).toLowerCase());
		if (!found.length) return;
		colors = found;
		palette = 'custom';
	}

	function pickColor(i: number, color: string) {
		colors[i] = color;
		hexes = colors.join(' ');
		palette = 'custom';
	}

	let background = $state(saved('background', '#08080a'));
	let land = $state(saved('land', '#14141a'));
	let outline = $state(saved('outline', '#e6e6ea'));
	let borders = $state(saved('borders', '#2b85aa'));
	let transparent = $state(saved('transparent', false));

	/** Set in capitals in a top corner, a line of the canvas for each line typed. */
	let title = $state(saved('title', 'Tokyo'));
	let titleColor = $state(saved('titleColor', '#e6e6ea'));
	let titleSize = $state(saved('titleSize', 64));
	let titleWeight = $state(saved('titleWeight', 600));
	/** `left` and `right` are the top corners, as they were saved before the bottom ones existed. */
	let titleCorner = $state<'left' | 'right' | 'bottom-left' | 'bottom-right'>(
		saved('titleCorner', 'left')
	);

	/** A map pin, its tip on a latitude and longitude. Starts on 都庁, the seat of the prefecture. */
	let pin = $state(saved('pin', true));
	let pinLat = $state(saved('pinLat', 35.6896));
	let pinLng = $state(saved('pinLng', 139.6917));
	let pinSize = $state(saved('pinSize', 40));
	let pinFill = $state(saved('pinFill', '#d9412b'));
	let pinBorder = $state(saved('pinBorder', '#e6e6ea'));
	let pinBorderWidth = $state(saved('pinBorderWidth', 2));

	let terrain = $state<'off' | 'contours' | 'relief'>(saved('terrain', 'off'));
	/** Metres between contour lines. */
	let interval = $state<'10' | '20' | '50' | '100'>(saved('interval', '50'));
	let contourWidth = $state(saved('contourWidth', 0.4));
	let contours = $state(saved('contours', '#7a7a84'));
	let reliefStrength = $state(saved('reliefStrength', 0.6));
	let exaggeration = $state(saved('exaggeration', 3));

	$effect(() => {
		const settings = {
			outlineWidth,
			borderWidth,
			margin,
			jitter,
			islands,
			seed,
			fill,
			palette,
			colors,
			hexes,
			background,
			land,
			outline,
			borders,
			transparent,
			title,
			titleColor,
			titleSize,
			titleWeight,
			titleCorner,
			terrain,
			interval,
			contourWidth,
			contours,
			reliefStrength,
			exaggeration,
			exportSize,
			aspect,
			pin,
			pinLat,
			pinLng,
			pinSize,
			pinFill,
			pinBorder,
			pinBorderWidth
		};
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		} catch {
			// Storage full or blocked: the page still works, it just won't remember.
		}
	});

	// ── geometry ────────────────────────────────────────

	/** Where longitude and latitude land on the canvas: the coast fitted inside the margin. */
	const frame = $derived.by(() => {
		let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
		for (const ring of coast) {
			for (let i = 0; i < ring.length; i += 2) {
				west = Math.min(west, ring[i]);
				east = Math.max(east, ring[i]);
				south = Math.min(south, ring[i + 1]);
				north = Math.max(north, ring[i + 1]);
			}
		}
		// Equirectangular about the middle latitude: true to shape across a span this small.
		const squash = Math.cos((((south + north) / 2) * Math.PI) / 180);
		const width = (east - west) * squash;
		const height = north - south;
		// The margin is a share of the canvas's shorter side, the same on all four.
		const inset = (Math.min(WIDTH, HEIGHT) * margin) / 100;
		const scale = Math.min((WIDTH - 2 * inset) / width, (HEIGHT - 2 * inset) / height);
		// x = x0 + lon * kx, y = y0 - lat * ky
		const kx = squash * scale;
		return {
			kx,
			ky: scale,
			x0: (WIDTH - width * scale) / 2 - west * kx,
			y0: (HEIGHT - height * scale) / 2 + north * scale
		};
	});

	/** Lines as flat [lon, lat, …] → one path. */
	const project = $derived.by(() => {
		const { x0, y0, kx, ky } = frame;
		return (lines: number[][], close: boolean) => {
			let d = '';
			for (const line of lines) {
				for (let i = 0; i < line.length; i += 2) {
					const x = x0 + line[i] * kx;
					const y = y0 - line[i + 1] * ky;
					d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
				}
				if (close) d += 'Z';
			}
			return d;
		};
	});

	const coast = $derived(
		islands ? [...tokyo.mainland.outline, ...tokyo.izu.outline] : tokyo.mainland.outline
	);
	const paths = $derived({
		coast: project(coast, true),
		borders: project(tokyo.mainland.borders, false)
	});

	// ── municipalities ──────────────────────────────────

	/** Which areas touch: the simplified shapes share their border vertices exactly. */
	const neighbours = (() => {
		const at: Record<string, number[]> = {};
		const out = tokyo.areas.map(() => new Set<number>());
		tokyo.areas.forEach((area, a) => {
			for (const ring of area.rings) {
				for (let i = 0; i < ring.length; i += 2) {
					const here = (at[`${ring[i]},${ring[i + 1]}`] ??= []);
					for (const b of here) {
						if (b === a) continue;
						out[a].add(b);
						out[b].add(a);
					}
					here.push(a);
				}
			}
		});
		return out;
	})();

	/** mulberry32: a small seeded generator, so a seed always draws the same picture. */
	function random(seed: number) {
		let t = seed;
		return () => {
			t = (t + 0x6d2b79f5) | 0;
			let r = Math.imul(t ^ (t >>> 15), 1 | t);
			r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
			return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
		};
	}

	/** Per area: where in the stack it sits, and a unit offset to scale by the jitter. */
	const scatter = $derived.by(() => {
		const next = random(seed);
		return tokyo.areas.map(() => {
			const angle = next() * Math.PI * 2;
			const reach = Math.sqrt(next()); // even over the disc
			return { order: next(), x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
		});
	});

	/** Per area: an index into the palette that no neighbour was given, where one is left. */
	const shades = $derived.by(() => {
		const next = random(seed + 0x9e3779b9);
		const count = colors.length;
		const out: number[] = [];
		tokyo.areas.forEach((_, a) => {
			const taken = new Set([...neighbours[a]].map((b) => out[b]));
			const free = Array.from({ length: count }, (_, i) => i).filter((i) => !taken.has(i));
			out[a] = free.length ? free[Math.floor(next() * free.length)] : Math.floor(next() * count);
		});
		return out;
	});

	const shapes = $derived(
		tokyo.areas
			.map((area, i) => ({ area, i }))
			.filter(({ area }) => islands || area.region === 'mainland')
			.map(({ area, i }) => ({ code: area.code, i, d: project(area.rings, true) }))
	);

	/** The shapes as drawn: coloured, nudged by the jitter, and stacked in a shuffled order. */
	const pieces = $derived(
		shapes
			.map(({ code, i, d }) => ({
				code,
				d,
				order: scatter[i].order,
				fill: fill === 'palette' ? colors[shades[i]] : land,
				move: `translate(${(scatter[i].x * jitter).toFixed(2)} ${(scatter[i].y * jitter).toFixed(2)})`
			}))
			.sort((a, b) => a.order - b.order)
	);

	// ── terrain ─────────────────────────────────────────

	/** The mainland's elevations, fetched the first time terrain is switched on. */
	let dem = $state.raw<Float32Array | null>(null);
	let demError = $state('');
	let demRequested = false;

	$effect(() => {
		if (terrain === 'off' || demRequested) return;
		demRequested = true;
		fetch(asset('/tokyo-outline/dem.bin'))
			.then(async (res) => {
				if (!res.ok) throw new Error(`http ${res.status}`);
				dem = decodeDem(new Uint8Array(await res.arrayBuffer()), demMeta.width);
			})
			.catch((e) => {
				demError = `elevation failed to load: ${(e as Error).message}`;
				demRequested = false;
			});
	});

	/** The elevation grid on the canvas: grid point (i, j) → canvas, as an SVG transform. */
	const gridScale = $derived({ x: demMeta.dlon * frame.kx, y: demMeta.dlat * frame.ky });
	const gridTransform = $derived(
		`translate(${frame.x0 + demMeta.west * frame.kx} ${frame.y0 - demMeta.north * frame.ky}) ` +
			`scale(${gridScale.x} ${gridScale.y})`
	);

	const relief = $derived(
		terrain === 'relief' && dem ? reliefImage(dem, demMeta, exaggeration) : ''
	);

	const tracer = new ContourTracer();
	onDestroy(() => tracer.terminate());
	/** Contour lines in grid coordinates; every fifth is an index contour, drawn heavier. */
	let lines = $state.raw({ minor: '', major: '' });

	$effect(() => {
		if (terrain !== 'contours' || !dem) return;
		const { width, height } = demMeta;
		tracer
			.trace(
				{ width, height, data: dem },
				{
					interval: Number(interval),
					majorEvery: 5,
					smoothing: 1,
					outWidth: width - 1,
					outHeight: height - 1,
					skipBelowSea: false,
					tolerance: 0.2
				}
			)
			.then((res) => {
				if (!res) return;
				const join = (major: boolean) =>
					res.paths
						.filter((p) => p.major === major)
						.map((p) => p.d)
						.join('');
				lines = { minor: join(false), major: join(true) };
			})
			.catch((e) => (demError = `contours failed: ${(e as Error).message}`));
	});

	const terrainShown = $derived(
		terrain === 'relief' ? relief !== '' : terrain === 'contours' && lines.minor !== ''
	);

	// ── pin ─────────────────────────────────────────────

	/** Head radius over the pin's whole height: a wide head on a short point. */
	const PIN_HEAD = 0.42;

	/** The pin with its tip at the origin: a round head, and two tangents down to the point. */
	const pinShape = $derived.by(() => {
		const r = pinSize * PIN_HEAD;
		const drop = pinSize - r; // tip to the head's centre
		const lean = Math.acos(r / drop);
		const x = r * Math.sin(lean);
		const y = r * Math.cos(lean) - drop;
		const n = (v: number) => v.toFixed(2);
		return { d: `M0 0L${n(x)} ${n(y)}A${n(r)} ${n(r)} 0 1 0 ${n(-x)} ${n(y)}Z`, r, drop };
	});
	const pinAt = $derived(
		`translate(${(frame.x0 + pinLng * frame.kx).toFixed(2)} ${(frame.y0 - pinLat * frame.ky).toFixed(2)})`
	);

	// ── title ───────────────────────────────────────────

	const FONT = 'https://fonts.googleapis.com/css2?family=Oswald:wght@200..700';
	/** How far the title sits in from the canvas edges. */
	const TITLE_INSET = 48;
	/** Oswald's capitals stand this tall, in ems: the first line's tops meet the inset. */
	const CAP_HEIGHT = 0.81;
	const LEADING = 1.12;

	const titleLines = $derived(title.toUpperCase().split('\n'));
	const titleShown = $derived(title.trim() !== '');
	const titleOnLeft = $derived(titleCorner.endsWith('left'));
	/** The first line's baseline: capitals against the top inset, or the last line on the bottom one. */
	const titleTop = $derived(
		titleCorner.startsWith('bottom')
			? HEIGHT - TITLE_INSET - (titleLines.length - 1) * titleSize * LEADING
			: TITLE_INSET + titleSize * CAP_HEIGHT
	);

	/**
	 * Oswald as a stylesheet with the font inside it. An SVG drawn as an image can't fetch a
	 * web font, so the export carries its own: just the glyphs the title uses, which Google
	 * Fonts cuts to order.
	 */
	async function embeddedFont(text: string): Promise<string> {
		const glyphs = [...new Set(text)].sort().join('');
		const css = await (await fetch(`${FONT}&text=${encodeURIComponent(glyphs)}`)).text();
		const src = /url\((https:[^)]+)\)/.exec(css)?.[1];
		if (!src) throw new Error('no font in the stylesheet');
		const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
		let binary = '';
		for (const b of bytes) binary += String.fromCharCode(b);
		return css.replace(src, `data:font/woff2;base64,${btoa(binary)}`);
	}

	// ── export ──────────────────────────────────────────

	let svg: SVGSVGElement | undefined = $state();
	let exportSize = $state<'1024' | '2048' | '4096'>(saved('exportSize', '2048'));
	let exporting = $state(false);
	let exportError = $state('');

	async function exportPng() {
		if (!svg) return;
		exporting = true;
		exportError = '';
		// Drop Svelte's scoped class names so the file is plain SVG, and give it a pixel size.
		const clone = svg.cloneNode(true) as SVGSVGElement;
		for (const el of [clone, ...clone.querySelectorAll('*')]) el.removeAttribute('class');
		const w = Number(exportSize);
		const h = Math.round((w * HEIGHT) / WIDTH);
		clone.setAttribute('width', String(w));
		clone.setAttribute('height', String(h));
		let url = '';
		try {
			if (titleShown) {
				const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
				style.textContent = await embeddedFont(titleLines.join(''));
				clone.prepend(style);
			}
			url = URL.createObjectURL(
				new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
			);
			const img = new Image();
			img.src = url;
			await img.decode();
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
			const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
			if (!blob) return;
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `tokyo-outline-${w}x${h}.png`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		} catch (e) {
			exportError = `export failed: ${(e as Error).message}`;
		} finally {
			URL.revokeObjectURL(url);
			exporting = false;
		}
	}
</script>

<svelte:head>
	<title>Tokyo Outline · Carto</title>
	<link rel="stylesheet" href="{FONT}&display=swap" />
</svelte:head>

<section class="head">
	<h1>Tokyo Outline</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
		<span>23 ku · 26 shi · 3 machi · 1 mura</span>
	</div>
</section>

<section class="explorer">
	<svg
		bind:this={svg}
		class="canvas"
		viewBox="0 0 {WIDTH} {HEIGHT}"
		style:aspect-ratio="{WIDTH} / {HEIGHT}"
		xmlns="http://www.w3.org/2000/svg"
	>
		<defs>
			<clipPath id="coast"><path d={paths.coast} /></clipPath>
			{#if terrainShown}
				<!-- Drawn in the elevation grid's own coordinates and placed by one transform, so
				     moving the map never rebuilds it. Widths are divided back out of that scale. -->
				<g id="terrain" transform={gridTransform}>
					{#if terrain === 'relief'}
						<!-- A pixel is centred on its grid point. -->
						<image
							href={relief}
							x="-0.5"
							y="-0.5"
							width={demMeta.width}
							height={demMeta.height}
							opacity={reliefStrength}
							preserveAspectRatio="none"
						/>
					{:else}
						<g fill="none" stroke={contours} stroke-linejoin="round" stroke-linecap="round">
							<path d={lines.minor} stroke-width={contourWidth / gridScale.x} />
							<path d={lines.major} stroke-width={(contourWidth * 2) / gridScale.x} />
						</g>
					{/if}
				</g>
				{#if jitter > 0}
					{#each pieces as p (p.code)}
						<clipPath id="area-{p.code}"><path d={p.d} /></clipPath>
					{/each}
				{/if}
			{/if}
		</defs>
		{#if !transparent}<rect width={WIDTH} height={HEIGHT} fill={background} />{/if}
		{#if jitter > 0}
			<!-- Each piece is swollen by the jitter, a stroke of its own colour, so that however
			     two neighbours are nudged they still overlap rather than part. Nothing is shared
			     any more, so each carries its own border outside that, and the outline is a wider
			     stroke behind the whole pile, which shows only around its edge. -->
			{#if outlineWidth > 0}
				<g
					fill={outline}
					stroke={outline}
					stroke-width={(jitter + borderWidth + outlineWidth) * 2}
					stroke-linejoin="round"
				>
					{#each pieces as p (p.code)}<path d={p.d} transform={p.move} />{/each}
				</g>
			{/if}
			<g stroke-linejoin="round">
				{#each pieces as p (p.code)}
					<g transform={p.move}>
						{#if borderWidth > 0}
							<path
								d={p.d}
								fill={borders}
								stroke={borders}
								stroke-width={(jitter + borderWidth) * 2}
							/>
						{/if}
						<path d={p.d} fill={p.fill} stroke={p.fill} stroke-width={jitter * 2} />
						<!-- Each piece takes its own terrain with it, inside its true shape. -->
						{#if terrainShown}
							<use href="#terrain" clip-path="url(#area-{p.code})" />
						{/if}
					</g>
				{/each}
			</g>
		{:else}
			<path d={paths.coast} fill={land} />
			{#if fill === 'palette'}
				<!-- A hairline of each shape's own colour closes the seams between neighbours. -->
				<g stroke-width="0.5" stroke-linejoin="round">
					{#each pieces as p (p.code)}<path d={p.d} fill={p.fill} stroke={p.fill} />{/each}
				</g>
			{/if}
			{#if terrainShown}<use href="#terrain" clip-path="url(#coast)" />{/if}
			<!-- Clipped so a wide border's round caps never poke out past a thin outline. -->
			{#if borderWidth > 0}
				<path
					d={paths.borders}
					fill="none"
					stroke={borders}
					stroke-width={borderWidth}
					stroke-linejoin="round"
					stroke-linecap="round"
					clip-path="url(#coast)"
				/>
			{/if}
			{#if outlineWidth > 0}
				<path
					d={paths.coast}
					fill="none"
					stroke={outline}
					stroke-width={outlineWidth}
					stroke-linejoin="round"
				/>
			{/if}
		{/if}
		{#if titleShown}
			<text
				y={titleTop}
				fill={titleColor}
				font-family="Oswald, sans-serif"
				font-size={titleSize}
				font-weight={titleWeight}
				text-anchor={titleOnLeft ? 'start' : 'end'}
			>
				{#each titleLines as line, i (i)}
					<!-- An empty line still takes its step down, so blank lines space the title. -->
					<tspan
						x={titleOnLeft ? TITLE_INSET : WIDTH - TITLE_INSET}
						dy={i ? titleSize * LEADING : 0}>{line || ' '}</tspan
					>
				{/each}
			</text>
		{/if}
		{#if pin}
			<!-- Last, so nothing covers it. It marks the true spot even when jitter moves the land. -->
			<g transform={pinAt}>
				<path
					d={pinShape.d}
					fill={pinFill}
					stroke={pinBorderWidth > 0 ? pinBorder : 'none'}
					stroke-width={pinBorderWidth}
					stroke-linejoin="round"
				/>
				<circle cy={-pinShape.drop} r={pinShape.r * 0.38} fill={pinBorder} />
			</g>
		{/if}
	</svg>

	<div class="panel">
		<Segmented
			label="aspect ratio"
			options={[{ value: '1:1' }, { value: '16:9' }]}
			bind:value={aspect}
		/>
		<Slider
			label="outline thickness"
			min={0}
			max={16}
			step={0.25}
			bind:value={outlineWidth}
			format={(v) => v.toFixed(2)}
		/>
		<Slider
			label="border width"
			min={0}
			max={8}
			step={0.25}
			bind:value={borderWidth}
			format={(v) => v.toFixed(2)}
		/>
		<Slider label="margin" min={0} max={25} bind:value={margin} format={(v) => `${v}%`} />
		<Slider
			label="jitter"
			min={0}
			max={12}
			step={0.25}
			bind:value={jitter}
			format={(v) => v.toFixed(2)}
		/>

		<div class="group">
			<Segmented
				label="fill"
				options={[{ value: 'single' }, { value: 'palette' }]}
				bind:value={fill}
			/>
			{#if fill === 'palette'}
				<Select
					label="palette"
					options={[...PALETTES.map((p) => ({ value: p.id, label: p.label })), { value: 'custom' }]}
					bind:value={palette}
					onchange={usePreset}
				/>
				<div class="swatches">
					{#each { length: colors.length }, i (i)}
						<input
							type="color"
							aria-label="palette colour {i + 1}"
							bind:value={() => colors[i], (v) => pickColor(i, v)}
						/>
					{/each}
				</div>
				<PromptField
					aria-label="palette hex codes"
					placeholder="#f3e2a6 #ebb47c #c76a62"
					bind:value={() => hexes, typePalette}
				/>
			{:else}
				<ColorField label="land" bind:value={land} />
			{/if}
			<Button onclick={() => seed++} disabled={fill === 'single' && jitter === 0}>shuffle</Button>
		</div>

		<div class="group">
			<Segmented
				label="terrain"
				options={[{ value: 'off' }, { value: 'contours' }, { value: 'relief' }]}
				bind:value={terrain}
			/>
			{#if terrain === 'contours'}
				<Segmented
					label="contour interval in metres"
					options={[
						{ value: '10', label: '10 m' },
						{ value: '20', label: '20 m' },
						{ value: '50', label: '50 m' },
						{ value: '100', label: '100 m' }
					]}
					bind:value={interval}
				/>
				<Slider
					label="contour width"
					min={0.1}
					max={2}
					step={0.05}
					bind:value={contourWidth}
					format={(v) => v.toFixed(2)}
				/>
				<ColorField label="contours" bind:value={contours} />
			{:else if terrain === 'relief'}
				<Slider
					label="relief strength"
					min={0.1}
					max={1}
					step={0.05}
					bind:value={reliefStrength}
					format={(v) => `${Math.round(v * 100)}%`}
				/>
				<Slider
					label="relief exaggeration"
					min={1}
					max={10}
					step={0.5}
					bind:value={exaggeration}
					format={(v) => `${v}×`}
				/>
			{/if}
			{#if demError}
				<p class="note error">{demError}</p>
			{:else if terrain !== 'off' && !terrainShown}
				<p class="note">loading elevation…</p>
			{/if}
		</div>

		<div class="group">
			<ColorField label="outline" bind:value={outline} />
			<ColorField label="borders" bind:value={borders} />
			<ColorField label="background" bind:value={background} disabled={transparent} />
			<Toggle label="transparent background" bind:checked={transparent} />
		</div>

		<Toggle label="izu islands" bind:checked={islands} />

		<div class="group">
			<label class="field">
				<span class="label">title</span>
				<textarea rows="3" spellcheck="false" bind:value={title}></textarea>
			</label>
			<Segmented
				label="title corner"
				options={[
					{ value: 'left', label: '↖ top' },
					{ value: 'right', label: 'top ↗' },
					{ value: 'bottom-left', label: '↙ bottom' },
					{ value: 'bottom-right', label: 'bottom ↘' }
				]}
				bind:value={titleCorner}
			/>
			<Slider label="title size" min={16} max={160} bind:value={titleSize} />
			<Slider label="title weight" min={200} max={700} step={100} bind:value={titleWeight} />
			<ColorField label="title" bind:value={titleColor} />
		</div>

		<div class="group">
			<Toggle label="pin" bind:checked={pin} />
			{#if pin}
				<div class="pair">
					<NumberField
						label="latitude"
						unit="° n"
						min={-90}
						max={90}
						step={0.0001}
						bind:value={pinLat}
					/>
					<NumberField
						label="longitude"
						unit="° e"
						min={-180}
						max={180}
						step={0.0001}
						bind:value={pinLng}
					/>
				</div>
				<Slider label="pin size" min={8} max={160} bind:value={pinSize} />
				<ColorField label="pin fill" bind:value={pinFill} />
				<ColorField label="pin border" bind:value={pinBorder} />
				<Slider
					label="pin border width"
					min={0}
					max={12}
					step={0.25}
					bind:value={pinBorderWidth}
					format={(v) => v.toFixed(2)}
				/>
			{/if}
		</div>

		<div class="group">
			<Segmented
				label="export width in pixels"
				options={[{ value: '1024' }, { value: '2048' }, { value: '4096' }]}
				bind:value={exportSize}
			/>
			<Button variant="primary" onclick={exportPng} disabled={exporting}>
				{exporting ? 'exporting…' : 'export png'}
			</Button>
			{#if exportError}<p class="note error">{exportError}</p>{/if}
		</div>

		<Button onclick={resetSettings}>reset settings</Button>
	</div>
</section>

<DataCredits credits={[CREDITS.ksjBoundaries, CREDITS.gsiDem]} />

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
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.explorer {
		margin-top: 56px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 48px;
		align-items: start;
	}
	.canvas {
		display: block;
		width: 100%;
		/* Shows where the canvas ends when its background matches the page or is transparent. */
		outline: 1px solid var(--color-line);
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	textarea {
		display: block;
		width: 100%;
		padding: 12px 14px;
		font: inherit;
		font-size: var(--text-body);
		line-height: 1.6;
		text-transform: uppercase;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
		border-radius: 0;
		resize: vertical;
	}
	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.note {
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
	}
	.error {
		color: var(--color-danger);
	}
	.swatches {
		display: flex;
		height: 20px;
		border: 1px solid var(--color-line-control);
	}
	.swatches input {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.swatches input::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	.swatches input::-webkit-color-swatch {
		border: 0;
	}
	.swatches input::-moz-color-swatch {
		border: 0;
	}
	.swatches input:focus-visible {
		outline: 1px solid var(--color-accent);
		outline-offset: 4px;
	}
	@media (min-width: 960px) {
		/* The panel is taller than the screen: keep the map in view beside it. */
		.canvas {
			position: sticky;
			top: 24px;
			max-height: calc(100dvh - 48px);
		}
	}
	@media (max-width: 959px) {
		.explorer {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 719px) {
		.head {
			padding-top: 48px;
		}
	}
</style>
