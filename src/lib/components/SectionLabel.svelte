<!-- `LABEL · count ————hairline———— descriptor` -->
<script lang="ts">
	type Props = { label: string; count?: number | string; descriptor?: string; index?: string };

	let { label, count, descriptor, index }: Props = $props();
</script>

<div class="section-label">
	{#if index}<span class="index">{index}</span>{/if}
	<span class="label">{label}</span>
	{#if count !== undefined}
		<span class="dot">·</span><span class="count">{count}</span>
	{/if}
	<span class="rule"></span>
	{#if descriptor}<span class="descriptor">{descriptor}</span>{/if}
</div>

<style>
	.section-label {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		color: var(--color-text-label);
	}
	.index {
		color: var(--color-accent);
		letter-spacing: var(--tracking-micro);
	}
	.label {
		text-transform: uppercase;
	}
	.dot {
		color: var(--color-text-faint);
	}
	.count {
		color: var(--color-text-secondary);
	}
	.rule {
		flex: 1;
		height: 1px;
		background: var(--color-line);
	}
	.descriptor {
		text-transform: lowercase;
		letter-spacing: 0.04em;
	}
</style>
