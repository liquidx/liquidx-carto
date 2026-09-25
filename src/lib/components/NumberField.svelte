<!-- Numeric input, styled like Select: UPPERCASE label above a surface box with a unit suffix. -->
<script lang="ts">
	type Props = {
		value?: number;
		label?: string;
		unit?: string;
		min?: number;
		max?: number;
		step?: number;
		onchange?: (value: number) => void;
	};

	let { value = $bindable(0), label, unit, min, max, step = 1, onchange }: Props = $props();

	// Edit a local copy and commit on change, so partial input ("8" on the way to "800") never
	// reaches the bound value.
	let draft = $derived(value);

	function commit() {
		let v = Number(draft);
		if (!Number.isFinite(v)) v = value;
		if (min !== undefined) v = Math.max(min, v);
		if (max !== undefined) v = Math.min(max, v);
		draft = v;
		if (v !== value) {
			value = v;
			onchange?.(v);
		}
	}
</script>

<label class="number">
	{#if label}<span class="label">{label}</span>{/if}
	<span class="box">
		<input
			type="number"
			inputmode="decimal"
			{min}
			{max}
			{step}
			bind:value={draft}
			onchange={commit}
			onkeydown={(e) => e.key === 'Enter' && commit()}
		/>
		{#if unit}<span class="unit">{unit}</span>{/if}
	</span>
</label>

<style>
	.number {
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
		display: flex;
		align-items: center;
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
	}
	.box:focus-within {
		border-color: var(--color-accent);
	}
	input {
		appearance: textfield;
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: var(--text-small);
		color: var(--color-text-ui);
		background: none;
		border: 0;
		outline: none;
		padding: 9px 12px;
	}
	input::-webkit-inner-spin-button,
	input::-webkit-outer-spin-button {
		appearance: none;
		margin: 0;
	}
	.unit {
		padding-right: 12px;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
</style>
