<!-- Square 40×20 switch: accent border + tint when on, square accent knob. -->
<script lang="ts">
	type Props = {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
		onchange?: (checked: boolean) => void;
	};

	let { checked = $bindable(false), label, disabled = false, onchange }: Props = $props();

	function toggle() {
		checked = !checked;
		onchange?.(checked);
	}
</script>

<label class="row" class:disabled>
	{#if label}<span class="label">{label}</span>{/if}
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		aria-label={label}
		{disabled}
		class="track"
		class:on={checked}
		onclick={toggle}
	>
		<span class="knob"></span>
	</button>
</label>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		cursor: pointer;
	}
	.label {
		font-size: var(--text-content);
		color: var(--color-text);
	}
	.track {
		position: relative;
		flex: none;
		width: 40px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--color-line-control);
		background: none;
		cursor: pointer;
	}
	.knob {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 16px;
		height: 16px;
		background: var(--color-text-faint);
	}
	.on {
		border-color: var(--color-accent);
		background: rgba(54, 182, 233, 0.15);
	}
	.on .knob {
		left: auto;
		right: 1px;
		background: var(--color-accent);
	}
	.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.disabled .track {
		cursor: not-allowed;
	}
</style>
