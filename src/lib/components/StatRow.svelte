<!-- Headline numbers: large value + faint unit, with a short lowercase caption beneath. -->
<script lang="ts">
	type Stat = { value: string | number; unit?: string; label: string };
	type Props = { stats: Stat[] };

	let { stats }: Props = $props();
</script>

<dl class="stats">
	{#each stats as s (s.label)}
		<!-- Caption first for screen readers; shown beneath the value. -->
		<div class="stat">
			<dt class="label">{s.label}</dt>
			<dd class="value">
				{typeof s.value === 'number' ? s.value.toLocaleString('en') : s.value}{#if s.unit}<span
						class="unit">{s.unit}</span
					>{/if}
			</dd>
		</div>
	{/each}
</dl>

<style>
	.stats {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
		gap: 32px 48px;
	}
	.stat {
		display: flex;
		flex-direction: column-reverse;
		gap: 10px;
	}
	.value {
		margin: 0;
		font-size: var(--text-display);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
		color: var(--color-text);
	}
	.unit {
		margin-left: 6px;
		font-size: var(--text-title);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--color-text-faint);
	}
	.label {
		font-size: var(--text-small);
		line-height: 1.6;
		color: var(--color-text-tertiary);
	}
	@media (max-width: 719px) {
		.stats {
			gap: 28px 24px;
		}
		.value {
			font-size: 32px;
		}
	}
</style>
