<!--
	Horizontal grouped bars on one shared axis. Each row has a label, optional meta and one bar
	per series; values sit at the bar tips, hairline gridlines at `ticks`, and an optional
	reference line marks a threshold. Hover a bar for its note.
-->
<script lang="ts" generics="K extends string">
	type Series = { key: K; label: string; color: string };
	type Row = {
		label: string;
		meta?: string;
		values: Record<K, number>;
		/** Per-series detail for the hover tooltip. */
		notes?: Partial<Record<K, string>>;
	};
	type Props = {
		series: Series[];
		rows: Row[];
		/** Axis maximum; bars longer than this are clipped to the edge. */
		max: number;
		ticks?: number[];
		unit?: string;
		reference?: { value: number; label: string };
		label?: string;
	};

	let { series, rows, max, ticks = [], unit = '', reference, label }: Props = $props();

	const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
	const fmt = (v: number) => `${v.toLocaleString('en')}${unit}`;

	let hover = $state<{ row: number; key: K } | null>(null);
</script>

<figure class="chart" aria-label={label}>
	<div class="keys">
		{#each series as s (s.key)}
			<span class="key"><i style:background={s.color}></i>{s.label}</span>
		{/each}
	</div>

	<div class="plot">
		<div class="grid" aria-hidden="true">
			{#each ticks as t (t)}
				<span class="tick" style:left={pct(t)}><span class="cap">{fmt(t)}</span></span>
			{/each}
			{#if reference}
				<span class="tick ref" style:left={pct(reference.value)}
					><span class="cap">{reference.label}</span></span
				>
			{/if}
		</div>

		<div class="rows">
			{#each rows as row, r (row.label)}
				<div class="row">
					<div class="head">
						<span class="name">{row.label}</span>
						{#if row.meta}<span class="meta">{row.meta}</span>{/if}
					</div>
					<div class="bars">
						{#each series as s (s.key)}
							{@const v = row.values[s.key]}
							<div
								class="track"
								role="img"
								aria-label="{s.label}: {fmt(v)}"
								onpointerenter={() => (hover = { row: r, key: s.key })}
								onpointerleave={() => (hover = null)}
							>
								<span class="bar" style:width={pct(v)} style:background={s.color}></span>
								<span class="value" style:left="calc({pct(v)} + 8px)">{fmt(v)}</span>
								{#if hover?.row === r && hover.key === s.key}
									<span class="tip" style:left={pct(v)}>
										<span class="tip-series">{s.label}</span>
										{fmt(v)}{#if row.notes?.[s.key]}<span class="tip-note">{row.notes[s.key]}</span
											>{/if}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
</figure>

<style>
	.chart {
		margin: 0;
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 24px;
		margin-bottom: 28px;
		font-size: var(--text-small);
		color: var(--color-text-secondary);
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: 9px;
	}
	/* A key shaped like the bars it names. */
	.key i {
		width: 16px;
		height: 8px;
	}
	.plot {
		position: relative;
		/* Room on the right for the longest value label. */
		margin-right: 64px;
		padding-bottom: 28px;
	}
	.grid {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.tick {
		position: absolute;
		top: 0;
		bottom: 20px;
		width: 1px;
		background: var(--color-line);
	}
	.tick.ref {
		background: var(--color-text-faint);
	}
	.cap {
		position: absolute;
		top: calc(100% + 6px);
		transform: translateX(-50%);
		font-size: var(--text-meta);
		color: var(--color-text-faint);
		white-space: nowrap;
	}
	.tick.ref .cap {
		color: var(--color-text-tertiary);
	}
	.rows {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 16px;
		margin-bottom: 8px;
	}
	.name {
		font-size: var(--text-content);
		color: var(--color-text);
	}
	.meta {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.track {
		position: relative;
		height: 10px;
	}
	.bar {
		display: block;
		height: 100%;
		min-width: 2px;
		animation: var(--animate-bar-draw);
		transform-origin: left;
	}
	.value {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		font-size: var(--text-meta);
		line-height: 1;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}
	.tip {
		position: absolute;
		bottom: calc(100% + 8px);
		transform: translateX(-50%);
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 12px;
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
		box-shadow: var(--shadow-float);
		font-size: var(--text-small);
		color: var(--color-text);
		white-space: nowrap;
		pointer-events: none;
	}
	.tip-series {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.tip-note {
		font-size: var(--text-meta);
		color: var(--color-text-tertiary);
	}
</style>
