<!-- Stepped colour ramp for a map layer: square hairline-free cells between min and max labels. -->
<script lang="ts">
	type Props = { colors: string[]; min: string; max: string; label?: string };

	let { colors, min, max, label }: Props = $props();
</script>

<div class="legend" role="img" aria-label={label ?? `${min} to ${max}`}>
	<span class="end">{min}</span>
	<span class="ramp">
		{#each colors as c, i (i)}<i style:background={c}></i>{/each}
	</span>
	<span class="end">{max}</span>
</div>

<style>
	.legend {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.ramp {
		display: flex;
		gap: 2px;
		height: 8px;
		width: 120px;
		background: var(--color-map-ink);
	}
	.ramp i {
		flex: 1;
	}
</style>
