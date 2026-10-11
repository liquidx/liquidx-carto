<!--
	The game's map: the resort from straight above, north up, drawn flat. Contour lines over the
	snow, woods in dark green, water in light blue, the runs by difficulty and the lifts, with an
	arrow for the rider pointing the way they are going. Click to teleport.

	Names stay out of the way: the run or lift under the pointer is named in the corner, and the
	map opened up to fill the view writes them along the lines they belong to.
-->
<script lang="ts">
	import type { FeatureCollection, Position } from 'geojson';
	import { autoInterval, gridStats, toPathData, traceContours } from '$lib/contour/contour';
	import { xToLon, yToLat } from '$lib/contour/mercator';
	import { findProvider, sampleApiGrid } from '$lib/contour/terrain-api';
	import type { Game } from './game';
	import { DIFFICULTY_COLOR, type Lift, type Run } from './resort';

	type Props = {
		game: Game;
		/** Wood and forest polygons, if known. */
		woods?: FeatureCollection | null;
		/** Lakes and ponds as polygons, rivers and streams as lines, if known. */
		water?: FeatureCollection | null;
		/** Terrain provider id for the contours; coarse tiles are fine for a map this size. */
		provider?: string;
		/** Opened up to fill the view, with the names written on it. */
		expanded?: boolean;
		onteleport: (lon: number, lat: number) => void;
	};
	let {
		game,
		woods = null,
		water = null,
		provider = 'gsi',
		expanded = $bindable(false),
		onteleport
	}: Props = $props();

	/** Slower than this, in metres a second, the rider's facing stands in for their direction. */
	const MOVING = 2.5;
	const LIFT_COLOR = '#e8590c';
	/** The names' size in pixels, and a letter's width in the monospace they are set in. */
	const NAME_PX = 9;
	const LETTER_PX = NAME_PX * 0.68;

	/** The room there is for the map. */
	let boxWidth = $state(0);
	let boxHeight = $state(0);
	let marker = $state<HTMLElement>();

	type Box = { x0: number; z0: number; x1: number; z1: number };
	function bounds(points: Iterable<readonly number[]>): Box | null {
		const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
		for (const [x, z] of points) {
			b.x0 = Math.min(b.x0, x);
			b.x1 = Math.max(b.x1, x);
			b.z0 = Math.min(b.z0, z);
			b.z1 = Math.max(b.z1, z);
		}
		return b.x0 <= b.x1 ? b : null;
	}
	/** The runs and lifts, and how far the woods are known, in the game's frame. */
	const pistes = $derived(
		bounds([...game.resort.runs, ...game.resort.lifts].flatMap((f) => f.path))
	);
	const mapped = $derived(
		bounds(
			(function* () {
				for (const { geometry: g } of woods?.features ?? []) {
					const rings =
						g?.type === 'Polygon'
							? g.coordinates
							: g?.type === 'MultiPolygon'
								? g.coordinates.flat()
								: [];
					for (const r of rings) for (const p of r) yield game.frame.toWorld(p);
				}
			})()
		)
	);

	/**
	 * The ground the map shows, in the game's frame (x east, z south, metres): the runs and lifts
	 * with a margin, widened or heightened to the shape of the room for it, but no further than
	 * the woods are known, so the map never ends in bare snow that is really forest.
	 */
	const view = $derived.by(() => {
		if (!boxWidth || !boxHeight || !pistes) return null;
		const cx = (pistes.x0 + pistes.x1) / 2;
		const cz = (pistes.z0 + pistes.z1) / 2;
		const w = (pistes.x1 - pistes.x0) * 1.16;
		const h = (pistes.z1 - pistes.z0) * 1.16;
		const tight = { x0: cx - w / 2, z0: cz - h / 2, x1: cx + w / 2, z1: cz + h / 2 };
		const wide = Math.max(w, (h * boxWidth) / boxHeight);
		const high = Math.max(h, (w * boxHeight) / boxWidth);
		const limit = mapped ?? { x0: -Infinity, z0: -Infinity, x1: Infinity, z1: Infinity };
		const x0 = Math.max(cx - wide / 2, Math.min(limit.x0, tight.x0));
		const x1 = Math.min(cx + wide / 2, Math.max(limit.x1, tight.x1));
		const z0 = Math.max(cz - high / 2, Math.min(limit.z0, tight.z0));
		const z1 = Math.min(cz + high / 2, Math.max(limit.z1, tight.z1));
		return { x: x0, z: z0, w: x1 - x0, h: z1 - z0 };
	});
	/** The map's size in pixels: as big as the view fits in the room. */
	const fit = $derived(view ? Math.min(boxWidth / view.w, boxHeight / view.h) : 0);
	const width = $derived(view ? view.w * fit : 0);
	const height = $derived(view ? view.h * fit : 0);
	/** Metres of ground to a pixel of map. */
	const metres = $derived(view ? view.w / width : 1);
	/** Grid points across the map the contours are traced from: more for a bigger map. */
	const grid = $derived(Math.max(160, Math.min(480, Math.round(width / 2))));

	/** What the pointer is over: a lift, or every piece of a run by its name. */
	type Named = { key: string; name: string; color: string };
	const named = (f: Run | Lift): Named =>
		'difficulty' in f
			? { key: `run:${f.name}`, name: f.name, color: DIFFICULTY_COLOR[f.difficulty] }
			: { key: `lift:${f.id}`, name: f.name, color: LIFT_COLOR };
	let hover = $state.raw<Named | null>(null);

	const lengthOf = (path: [number, number][]) =>
		path.reduce(
			(sum, p, i) => sum + (i ? Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0),
			0
		);
	/** The point a distance along a path. */
	function along(path: [number, number][], distance: number): [number, number] {
		for (let i = 1; i < path.length; i++) {
			const [x0, z0] = path[i - 1];
			const [x1, z1] = path[i];
			const step = Math.hypot(x1 - x0, z1 - z0);
			if (distance <= step && step > 0)
				return [x0 + ((x1 - x0) * distance) / step, z0 + ((z1 - z0) * distance) / step];
			distance -= step;
		}
		return path[path.length - 1];
	}

	/** Each lift and each run to name, a run by its longest piece; lifts first, then by length. */
	const names = $derived.by(() => {
		// Built and read here only, never reactively.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const longest = new Map<
			string,
			{ name: string; lift: boolean; path: [number, number][]; length: number }
		>();
		for (const f of [...game.resort.runs, ...game.resort.lifts]) {
			if (!f.name) continue;
			const { key, name } = named(f);
			const length = lengthOf(f.path);
			if (length > (longest.get(key)?.length ?? 0))
				longest.set(key, { name, lift: !('difficulty' in f), path: f.path, length });
		}
		return [...longest.values()].sort(
			(a, b) => Number(b.lift) - Number(a.lift) || b.length - a.length
		);
	});

	/**
	 * The names written on the opened-up map: each set straight across the middle of its line,
	 * reading left to right, where the line is long enough to carry it and no name already
	 * written is in the way.
	 */
	const labels = $derived.by(() => {
		if (!expanded || !view) return [];
		const gap = NAME_PX * 1.4 * metres;
		const placed: {
			name: string;
			lift: boolean;
			x: number;
			z: number;
			turn: number;
			dots: number[][];
		}[] = [];
		for (const n of names) {
			const span = (n.name.length + 1) * LETTER_PX * metres;
			if (n.length < span) continue;
			const a = along(n.path, (n.length - span) / 2);
			const b = along(n.path, (n.length + span) / 2);
			const [p, q] = a[0] <= b[0] ? [a, b] : [b, a];
			const steps = Math.ceil(span / (NAME_PX * metres));
			const dots = Array.from({ length: steps + 1 }, (_, i) => [
				p[0] + ((q[0] - p[0]) * i) / steps,
				p[1] + ((q[1] - p[1]) * i) / steps
			]);
			const crowded = placed.some((o) =>
				o.dots.some((d) => dots.some((e) => Math.hypot(d[0] - e[0], d[1] - e[1]) < gap))
			);
			if (crowded) continue;
			placed.push({
				name: n.name,
				lift: n.lift,
				x: (p[0] + q[0]) / 2,
				z: (p[1] + q[1]) / 2,
				turn: (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI,
				dots
			});
		}
		return placed;
	});

	const line = (path: Position[] | [number, number][]) =>
		'M' + path.map((p) => `${Math.round(p[0])} ${Math.round(p[1])}`).join('L');
	const ring = (r: Position[]) => line(r.map(game.frame.toWorld)) + 'Z';
	/** Path data, in the game's frame, for the polygons of a collection and for its lines. */
	function paths(data: FeatureCollection | null) {
		let fill = '';
		let stroke = '';
		for (const { geometry: g } of data?.features ?? []) {
			if (g?.type === 'Polygon') fill += g.coordinates.map(ring).join('');
			else if (g?.type === 'MultiPolygon') fill += g.coordinates.flat().map(ring).join('');
			else if (g?.type === 'LineString') stroke += line(g.coordinates.map(game.frame.toWorld));
			else if (g?.type === 'MultiLineString')
				stroke += g.coordinates.map((l) => line(l.map(game.frame.toWorld))).join('');
		}
		return { fill, stroke };
	}
	const wood = $derived(paths(woods));
	const wet = $derived(paths(water));

	/** The contour lines and the corner of the view they were traced for. */
	let contours = $state.raw<{ x: number; z: number; minor: string; major: string } | null>(null);
	$effect(() => {
		const v = view;
		if (!v) return;
		let cancelled = false;
		const [x0, y0] = game.frame.worldToMercator(v.x, v.z);
		const [x1, y1] = game.frame.worldToMercator(v.x + v.w, v.z + v.h);
		const rows = Math.max(2, Math.round((grid * v.h) / v.w));
		sampleApiGrid(findProvider(provider), { x0, y0, x1, y1 }, grid, rows)
			.then(({ grid }) => {
				if (cancelled) return;
				const { min, max } = gridStats(grid);
				const levels = traceContours(grid, {
					interval: autoInterval(max - min, 24),
					majorEvery: 5,
					smoothing: 1,
					outWidth: v.w,
					outHeight: v.h,
					skipBelowSea: false,
					tolerance: v.w / 800
				});
				const data = (major: boolean) =>
					toPathData(levels.filter((l) => l.major === major).flatMap((l) => l.lines));
				contours = { x: v.x, z: v.z, minor: data(false), major: data(true) };
			})
			// The map still shows the way without its contours.
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	// The arrow follows the rider every frame, outside Svelte's reactivity.
	$effect(() => {
		const v = view;
		const el = marker;
		if (!v || !el) return;
		const scale = width / v.w;
		let frame = requestAnimationFrame(function tick() {
			const { rider } = game;
			const moving = rider.mode !== 'lift' && rider.speed > MOVING;
			// An angle in the x–z plane, which is the map's own: x east, z south.
			const way = moving ? Math.atan2(rider.velocity.z, rider.velocity.x) : rider.heading;
			const x = (rider.position.x - v.x) * scale;
			const y = (rider.position.z - v.z) * scale;
			el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${way.toFixed(3)}rad)`;
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	});

	function pick(e: MouseEvent) {
		if (!view) return;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const [mx, my] = game.frame.worldToMercator(
			view.x + ((e.clientX - r.left) / r.width) * view.w,
			view.z + ((e.clientY - r.top) / r.height) * view.h
		);
		onteleport(xToLon(mx), yToLat(my));
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="minimap" class:expanded bind:clientWidth={boxWidth} bind:clientHeight={boxHeight}>
	{#if view}
		<div
			class="map"
			title="click to teleport"
			style:width="{width}px"
			style:height="{height}px"
			onclick={pick}
		>
			<svg viewBox="{view.x} {view.z} {view.w} {view.h}" preserveAspectRatio="none">
				<path class="wood" d={wood.fill} />
				<path class="water" d={wet.fill} />
				<path class="waterway" d={wet.stroke} />
				{#if contours}
					<g transform="translate({contours.x} {contours.z})">
						<path class="contour" d={contours.minor} />
						<path class="contour major" d={contours.major} />
					</g>
				{/if}
				{#each game.resort.runs as run (run.id)}
					<path class="casing" d={line(run.path)} />
				{/each}
				{#each game.resort.runs as run (run.id)}
					<path
						class="run"
						class:over={hover?.key === named(run).key}
						d={line(run.path)}
						stroke={DIFFICULTY_COLOR[run.difficulty]}
					/>
				{/each}
				{#each game.resort.lifts as lift (lift.id)}
					<path class="lift" class:over={hover?.key === named(lift).key} d={line(lift.path)} />
					{#each [lift.path[0], lift.path[lift.path.length - 1]] as [x, z], i (i)}
						<circle class="station" cx={x} cy={z} r={2 * metres} />
					{/each}
				{/each}
				{#each labels as l (l.name + l.lift)}
					<text
						class="name"
						class:lift={l.lift}
						font-size={NAME_PX * metres}
						transform="translate({l.x} {l.z}) rotate({l.turn})"
						dy={-4 * metres}
					>
						{l.name}
					</text>
				{/each}
				<!-- Wide and unseen, over the lines: what the pointer has to find. -->
				{#each [...game.resort.runs, ...game.resort.lifts] as f (f.id)}
					{#if f.name}
						<path
							class="hit"
							d={line(f.path)}
							onpointerenter={() => (hover = named(f))}
							onpointerleave={() => (hover = null)}
						/>
					{/if}
				{/each}
			</svg>
			<div class="rider" bind:this={marker}>
				<svg viewBox="-10 -10 20 20"><path d="M9 0L-7 -6.5L-3.5 0L-7 6.5Z" /></svg>
			</div>
			{#if hover}
				<div class="caption"><span style:background={hover.color}></span>{hover.name}</div>
			{/if}
			<button
				type="button"
				class="expand"
				aria-label={expanded ? 'close the map' : 'open the map'}
				onclick={(e) => {
					e.stopPropagation();
					expanded = !expanded;
				}}
			>
				{expanded ? '×' : '⤢'}
			</button>
		</div>
	{/if}
</div>

<style>
	/* The room for the map: the map sits in its corner, or in the middle when opened up. */
	.minimap {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: end;
		pointer-events: none;
	}
	.minimap.expanded {
		place-items: center;
	}
	.map {
		position: relative;
		box-sizing: content-box;
		overflow: hidden;
		background: #f1f3f5;
		border: 1px solid rgba(8, 8, 10, 0.5);
		cursor: crosshair;
		pointer-events: auto;
	}
	.map > svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	path {
		fill: none;
		vector-effect: non-scaling-stroke;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.wood {
		fill: #2f5d43;
		fill-rule: evenodd;
	}
	.water {
		fill: #a5d8ff;
		fill-rule: evenodd;
	}
	.waterway {
		stroke: #a5d8ff;
		stroke-width: 1.5;
	}
	.contour {
		stroke: rgba(134, 148, 163, 0.5);
		stroke-width: 0.5;
	}
	.contour.major {
		stroke: rgba(134, 148, 163, 0.85);
		stroke-width: 0.75;
	}
	/* A snow-white edge keeps the runs apart from the woods they cut through. */
	.casing {
		stroke: #f1f3f5;
		stroke-width: 4;
	}
	.run {
		stroke-width: 2;
	}
	.run.over {
		stroke-width: 4;
	}
	.lift {
		stroke: #e8590c;
		stroke-width: 1.25;
	}
	.lift.over {
		stroke-width: 3;
	}
	.hit {
		stroke: transparent;
		stroke-width: 12;
		pointer-events: stroke;
	}
	/* Small, grey and haloed in snow: there to be read when looked for. */
	.name {
		font-family: inherit;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-anchor: middle;
		fill: #495057;
		stroke: #f1f3f5;
		stroke-width: 2.5;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
		paint-order: stroke;
		pointer-events: none;
	}
	.name.lift {
		fill: #a63e06;
	}
	.caption {
		position: absolute;
		left: 6px;
		bottom: 6px;
		max-width: calc(100% - 12px);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 7px;
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #212529;
		background: #f1f3f5;
		pointer-events: none;
	}
	.caption span {
		flex: none;
		width: 7px;
		height: 7px;
	}
	.expand {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 24px;
		height: 24px;
		padding: 0;
		font: inherit;
		font-size: var(--text-small);
		line-height: 1;
		color: #212529;
		background: #f1f3f5;
		border: 1px solid rgba(8, 8, 10, 0.35);
		cursor: pointer;
	}
	@media (pointer: coarse) {
		.expand {
			width: 32px;
			height: 32px;
		}
	}
	.station {
		fill: #e8590c;
		pointer-events: none;
	}
	.rider {
		position: absolute;
		top: -9px;
		left: -9px;
		width: 18px;
		height: 18px;
		pointer-events: none;
		will-change: transform;
	}
	.rider svg {
		display: block;
		overflow: visible;
	}
	.rider path {
		fill: #36b6e9;
		stroke: #08080a;
		stroke-width: 1.5;
		vector-effect: none;
	}
</style>
