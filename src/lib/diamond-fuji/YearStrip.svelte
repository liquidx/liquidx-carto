<!--
	A year of alignments: for each day, how far above or below the summit the sun's centre is as
	it crosses the summit's bearing. The band is the sun's own radius, so where the line enters
	it the disc touches the summit. Click or drag to pick a day.
-->
<script lang="ts">
	import { SUN_RADIUS, daysInYear, fmtDate, fmtTime, jstDay } from './sun';
	import type { AlignmentDay } from './alignment';

	type Props = {
		days: AlignmentDay[];
		year: number;
		/** Day of year, 1-based. */
		doy: number;
		onpick: (doy: number) => void;
	};

	let { days, year, doy, onpick }: Props = $props();

	const WIDTH = 1000;
	const HEIGHT = 150;
	const PAD = 18;
	const LIMIT = 3;

	const n = $derived(daysInYear(year));
	const px = (d: number) => ((d - 0.5) / n) * WIDTH;
	const py = (deg: number) =>
		PAD + ((LIMIT - Math.max(-LIMIT, Math.min(LIMIT, deg))) / (2 * LIMIT)) * (HEIGHT - 2 * PAD);

	const byDoy = $derived.by(() => {
		const start = jstDay(year, 1);
		// Rebuilt whole whenever the days change, so it never needs to be reactive itself.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const m = new Map<number, AlignmentDay>();
		for (const d of days) m.set(Math.round((d.day - start) / 86_400_000) + 1, d);
		return m;
	});

	/** Runs of consecutive days, each its own polyline, so gaps stay gaps. */
	const segments = $derived.by(() => {
		const out: string[] = [];
		let cur: string[] = [];
		for (let d = 1; d <= n; d++) {
			const a = byDoy.get(d);
			if (!a) {
				if (cur.length) out.push(cur.join(' '));
				cur = [];
				continue;
			}
			cur.push(`${px(d).toFixed(1)},${py(a.offset).toFixed(1)}`);
		}
		if (cur.length) out.push(cur.join(' '));
		return out;
	});

	const touching = $derived([...byDoy].filter(([, a]) => Math.abs(a.offset) <= SUN_RADIUS));

	const months = $derived.by(() => {
		const out: { doy: number; label: string }[] = [];
		const start = jstDay(year, 1);
		for (let m = 0; m < 12; m++) {
			const t = Date.UTC(year, m, 1) - 9 * 3_600_000;
			out.push({ doy: Math.round((t - start) / 86_400_000) + 1, label: fmtDate(t).slice(2) });
		}
		return out;
	});

	let svg: SVGSVGElement;
	let hover = $state<number | null>(null);

	function doyAt(e: PointerEvent) {
		const r = svg.getBoundingClientRect();
		const f = (e.clientX - r.left) / r.width;
		return Math.max(1, Math.min(n, Math.round(f * n + 0.5)));
	}
	function move(e: PointerEvent) {
		hover = doyAt(e);
		if (e.buttons & 1) onpick(hover);
	}

	const shown = $derived(byDoy.get(hover ?? doy));
	const shownDoy = $derived(hover ?? doy);
</script>

<div class="strip">
	<div class="readout">
		<span class="date">{fmtDate(jstDay(year, shownDoy))}</span>
		{#if shown}
			<span class="dot">·</span>
			<span>{fmtTime(shown.time)}</span>
			<span class="dot">·</span>
			<span class:touch={Math.abs(shown.offset) <= SUN_RADIUS}>
				sun {Math.abs(shown.offset).toFixed(2)}° {shown.offset >= 0 ? 'above' : 'below'} the summit
			</span>
		{:else}
			<span class="dot">·</span>
			<span class="faint">the sun never crosses the summit's bearing this day</span>
		{/if}
	</div>
	<svg
		bind:this={svg}
		viewBox="0 0 {WIDTH} {HEIGHT}"
		preserveAspectRatio="none"
		role="slider"
		aria-label="day of the year"
		aria-valuemin="1"
		aria-valuemax={n}
		aria-valuenow={doy}
		tabindex="0"
		onpointermove={move}
		onpointerdown={(e) => onpick(doyAt(e))}
		onpointerleave={() => (hover = null)}
		onkeydown={(e) => {
			if (e.key === 'ArrowLeft') onpick(Math.max(1, doy - 1));
			if (e.key === 'ArrowRight') onpick(Math.min(n, doy + 1));
		}}
	>
		<rect
			x="0"
			y={py(SUN_RADIUS)}
			width={WIDTH}
			height={py(-SUN_RADIUS) - py(SUN_RADIUS)}
			class="band"
		/>
		<line x1="0" x2={WIDTH} y1={py(0)} y2={py(0)} class="zero" />
		{#each months as m (m.doy)}
			<line
				x1={px(m.doy) - WIDTH / n / 2}
				x2={px(m.doy) - WIDTH / n / 2}
				y1={HEIGHT - 8}
				y2={HEIGHT}
				class="tick"
			/>
		{/each}
		{#each segments as d, i (i)}
			<polyline points={d} class="offset" />
		{/each}
		{#each touching as [d] (d)}
			<line x1={px(d)} x2={px(d)} y1={HEIGHT - 8} y2={HEIGHT} class="touch-tick" />
		{/each}
		<line x1={px(doy)} x2={px(doy)} y1="0" y2={HEIGHT} class="cursor" />
		{#if hover !== null && hover !== doy}
			<line x1={px(hover)} x2={px(hover)} y1="0" y2={HEIGHT} class="hover" />
		{/if}
	</svg>
	<div class="months">
		{#each months as m (m.doy)}
			<span style:left="{((m.doy - 1) / n) * 100}%">{m.label}</span>
		{/each}
	</div>
	<div class="scale">
		<span>+{LIMIT}°</span><span>0</span><span>−{LIMIT}°</span>
	</div>
</div>

<style>
	.strip {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.readout {
		display: flex;
		gap: 8px;
		font-size: var(--text-small);
		color: var(--color-text-secondary);
		min-height: 1.6em;
	}
	.date {
		color: var(--color-text);
	}
	.dot,
	.faint {
		color: var(--color-text-faint);
	}
	.touch {
		color: var(--color-accent);
	}
	svg {
		display: block;
		width: 100%;
		height: 150px;
		cursor: crosshair;
		touch-action: none;
	}
	svg:focus-visible {
		outline-offset: 6px;
	}
	.band {
		fill: var(--color-accent-tint);
	}
	.zero {
		stroke: var(--color-line-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.tick {
		stroke: var(--color-line-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.offset {
		fill: none;
		stroke: var(--color-text-secondary);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
	.touch-tick {
		stroke: var(--color-accent);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}
	.cursor {
		stroke: var(--color-accent);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.hover {
		stroke: var(--color-text-faint);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.months {
		position: relative;
		height: 1.4em;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.months span {
		position: absolute;
		top: 0;
		padding-left: 4px;
	}
	.scale {
		position: absolute;
		right: 0;
		top: 1.6em;
		height: 150px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 10px 0;
		font-size: var(--text-micro);
		color: var(--color-text-faint);
		pointer-events: none;
		text-align: right;
	}
</style>
