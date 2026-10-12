<!-- Colour control: UPPERCASE label + lowercase hex readout above a full-width square swatch. -->
<script lang="ts">
	type Props = { value?: string; label: string; disabled?: boolean };

	let { value = $bindable('#000000'), label, disabled = false }: Props = $props();
</script>

<label class="color" class:disabled>
	<span class="head">
		<span class="label">{label}</span>
		<span class="value">{value}</span>
	</span>
	<input type="color" bind:value {disabled} />
</label>

<style>
	.color {
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
		width: 100%;
		height: 20px;
		padding: 0;
		border: 1px solid var(--color-line-control);
		background: none;
		cursor: pointer;
	}
	input::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	input::-webkit-color-swatch {
		border: 0;
	}
	input::-moz-color-swatch {
		border: 0;
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
