<!--
	The view towards the summit: the horizon the terrain makes, a few degrees either side of the
	mountain, with the sun drawn where it is as it crosses the summit's bearing. Azimuth runs
	along the bottom; both axes are in degrees at the same scale, so the sun is round.
-->
<script lang="ts">
	import { SUN_RADIUS, fmtTime, jstParts } from './sun';
	import type { Skyline } from './alignment';

	type SunMark = { azimuth: number; apparent: number; time: number };
	type Props = {
		skyline: Skyline | null;
		/** Bearing and apparent elevation of the summit. */
		bearing: number;
		summitAngle: number;
		/** The sun's centre over a few minutes around the crossing, and the crossing itself. */
		path: SunMark[];
		sun: SunMark | null;
		/** Degrees either side of the summit to show. */
		halfSpan?: number;
	};

	let { skyline, bearing, summitAngle, path, sun, halfSpan = 4 }: Props = $props();

	/** Degrees shown above and below the summit. */
	const ABOVE = 2;
	const BELOW = 3;

	const WIDTH = 1000;
	const scale = $derived(WIDTH / (halfSpan * 2));
	const x0 = $derived(bearing - halfSpan);

	/** Vertical range: a fixed window around the summit, so the sun stays round and the view compact. */
	const range = $derived({ lo: summitAngle - BELOW, hi: summitAngle + ABOVE });
	const height = $derived((range.hi - range.lo) * scale);
	const px = (az: number) => (az - x0) * scale;
	const py = (deg: number) => (range.hi - deg) * scale;

	const horizon = $derived.by(() => {
		if (!skyline) return '';
		const pts: string[] = [];
		skyline.angles.forEach((a, i) => {
			const az = skyline.start + i * skyline.step;
			if (az < x0 || az > x0 + halfSpan * 2) return;
			pts.push(`${px(az).toFixed(1)},${py(a > -90 ? a : range.lo).toFixed(1)}`);
		});
		if (!pts.length) return '';
		return `M${px(x0)},${height} L${pts.join(' L')} L${px(x0 + halfSpan * 2)},${height} Z`;
	});

	const ticks = $derived.by(() => {
		const out: number[] = [];
		for (let a = Math.ceil(x0); a <= x0 + halfSpan * 2; a++) out.push(a);
		return out;
	});
	const labelled = (m: SunMark) => jstParts(m.time).minute % 10 === 0;
	/** Marks the window can show, with a little slack for a disc half out of it. */
	const shown = $derived(
		path.filter(
			(m) =>
				m.azimuth > x0 - 0.5 &&
				m.azimuth < x0 + halfSpan * 2 + 0.5 &&
				m.apparent > range.lo - 0.5 &&
				m.apparent < range.hi + 0.5
		)
	);
</script>

<svg viewBox="0 0 {WIDTH} {height}" class="skyline" role="img" aria-label="skyline with the sun">
	<defs>
		<clipPath id="skyline-window"><rect x="0" y="0" width={WIDTH} {height} /></clipPath>
	</defs>
	<g clip-path="url(#skyline-window)">
		{#if py(0) > 0 && py(0) < height}
			<line x1="0" x2={WIDTH} y1={py(0)} y2={py(0)} class="sea" />
		{/if}
		{#each ticks as a (a)}
			<line x1={px(a)} x2={px(a)} y1={height - 10} y2={height} class="tick" />
			<text x={px(a)} y={height - 16} class="tick-label">{a}°</text>
		{/each}

		{#each shown as m (m.time)}
			{#if sun && m.time === sun.time}
				<!-- drawn last, below -->
			{:else}
				<circle cx={px(m.azimuth)} cy={py(m.apparent)} r={SUN_RADIUS * scale} class="ghost" />
				{#if labelled(m)}
					<text x={px(m.azimuth)} y={py(m.apparent) - (SUN_RADIUS + 0.12) * scale} class="time"
						>{fmtTime(m.time)}</text
					>
				{/if}
			{/if}
		{/each}

		{#if horizon}
			<path d={horizon} class="terrain" />
		{/if}

		{#if sun}
			<circle cx={px(sun.azimuth)} cy={py(sun.apparent)} r={SUN_RADIUS * scale} class="sun" />
			<text x={px(sun.azimuth)} y={py(sun.apparent) - (SUN_RADIUS + 0.12) * scale} class="sun-time"
				>{fmtTime(sun.time)}</text
			>
		{/if}
	</g>
	<line
		x1={px(bearing)}
		x2={px(bearing)}
		y1={py(summitAngle) - 0.5 * scale}
		y2={py(summitAngle) - 0.15 * scale}
		class="summit"
	/>
	<text x={px(bearing)} y={py(summitAngle) - 0.6 * scale} class="summit-label"
		>summit · {bearing.toFixed(1)}° · {summitAngle.toFixed(2)}° up</text
	>
</svg>

<style>
	.skyline {
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--font-mono);
		overflow: visible;
		outline: 1px solid var(--color-line);
	}
	.terrain {
		fill: #1e1e24;
		stroke: var(--color-text-tertiary);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}
	.sea {
		stroke: var(--color-line-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.tick {
		stroke: var(--color-line-strong);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.tick-label {
		font-size: 10px;
		fill: var(--color-text-faint);
		text-anchor: middle;
	}
	.ghost {
		fill: none;
		stroke: var(--color-text-faint);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.time {
		font-size: 9px;
		fill: var(--color-text-faint);
		text-anchor: middle;
	}
	.sun {
		fill: var(--color-accent);
	}
	.sun-time {
		font-size: 10px;
		fill: var(--color-text);
		text-anchor: middle;
	}
	.summit {
		stroke: var(--color-text);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.summit-label {
		font-size: 10px;
		fill: var(--color-text-secondary);
		text-anchor: middle;
		letter-spacing: 0.04em;
	}
</style>
