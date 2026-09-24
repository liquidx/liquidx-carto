<!-- Native select, restyled: surface bg, hairline border, ▾ marker, accent focus border. -->
<script lang="ts" generics="T extends string">
	type Option = { value: T; label?: string };
	type Props = {
		options: Option[];
		value?: T;
		label?: string;
		onchange?: (value: T) => void;
	};

	let { options, value = $bindable(), label, onchange }: Props = $props();
</script>

<label class="select">
	{#if label}<span class="label">{label}</span>{/if}
	<span class="box">
		<select bind:value onchange={() => value !== undefined && onchange?.(value)}>
			{#each options as opt (opt.value)}
				<option value={opt.value}>{opt.label ?? opt.value}</option>
			{/each}
		</select>
		<span class="marker" aria-hidden="true">▾</span>
	</span>
</label>

<style>
	.select {
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
	.box {
		position: relative;
		display: flex;
	}
	select {
		appearance: none;
		width: 100%;
		font: inherit;
		font-size: var(--text-small);
		text-transform: lowercase;
		color: var(--color-text-ui);
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
		border-radius: 0;
		padding: 9px 32px 9px 12px;
		cursor: pointer;
	}
	select:focus-visible {
		outline: none;
		border-color: var(--color-accent);
	}
	option {
		background: var(--color-surface);
		color: var(--color-text-ui);
	}
	.marker {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		font-size: var(--text-meta);
		color: var(--color-accent);
		pointer-events: none;
	}
</style>
