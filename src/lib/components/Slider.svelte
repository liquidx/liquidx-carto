<!--
	Range control: UPPERCASE label + lowercase value readout above a hairline track
	with an accent fill and a square accent thumb.
-->
<script lang="ts">
	type Props = {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		label?: string;
		unit?: string;
		format?: (v: number) => string;
		disabled?: boolean;
		oninput?: (value: number) => void;
	};

	let {
		value = $bindable(0),
		min = 0,
		max = 100,
		step = 1,
		label,
		unit = '',
		format = (v) => String(v),
		disabled = false,
		oninput
	}: Props = $props();

	const pct = $derived(max === min ? 0 : ((value - min) / (max - min)) * 100);
</script>

<label class="slider" class:disabled>
	{#if label}
		<span class="head">
			<span class="label">{label}</span>
			<span class="value">{format(value)}{unit}</span>
		</span>
	{/if}
	<input
		type="range"
		{min}
		{max}
		{step}
		{disabled}
		bind:value
		oninput={() => oninput?.(value)}
		style:--pct="{pct}%"
	/>
</label>

<style>
	.slider {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.value {
		font-size: var(--text-small);
		color: var(--color-text);
	}
	input {
		appearance: none;
		width: 100%;
		height: 20px;
		margin: 0;
		background: transparent;
		cursor: pointer;
	}
	input::-webkit-slider-runnable-track {
		height: 2px;
		background: linear-gradient(
			90deg,
			var(--color-accent) 0 var(--pct),
			var(--color-line-strong) var(--pct) 100%
		);
	}
	input::-moz-range-track {
		height: 2px;
		background: var(--color-line-strong);
	}
	input::-moz-range-progress {
		height: 2px;
		background: var(--color-accent);
	}
	input::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		margin-top: -5px;
		border: 0;
		border-radius: 0;
		background: var(--color-accent);
	}
	input::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border: 0;
		border-radius: 0;
		background: var(--color-accent);
	}
	input:focus-visible {
		outline: 1px solid var(--color-accent);
		outline-offset: 4px;
	}
	.disabled {
		opacity: 0.4;
	}
	.disabled input {
		cursor: not-allowed;
	}
</style>
