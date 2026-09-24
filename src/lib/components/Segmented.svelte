<!--
	Segmented control for enumerations. Bordered group with 1px internal dividers;
	active cell = accent text + tint + 2px accent bottom bar.
-->
<script lang="ts" generics="T extends string">
	type Option = { value: T; label?: string; count?: number };
	type Props = {
		options: Option[];
		value?: T;
		label?: string;
		onchange?: (value: T) => void;
	};

	let { options, value = $bindable(), label, onchange }: Props = $props();

	function select(v: T) {
		value = v;
		onchange?.(v);
	}
</script>

<div class="group" role="radiogroup" aria-label={label} style:--cols={options.length}>
	{#each options as opt (opt.value)}
		<button
			type="button"
			role="radio"
			aria-checked={opt.value === value}
			class="cell"
			class:active={opt.value === value}
			onclick={() => select(opt.value)}
		>
			{opt.label ?? opt.value}
			{#if opt.count !== undefined}<span class="count">{opt.count}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.group {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		border: 1px solid var(--color-line-strong);
	}
	.cell {
		position: relative;
		font-family: inherit;
		font-size: var(--text-small);
		text-transform: lowercase;
		color: var(--color-text-faint);
		background: none;
		border: 0;
		border-right: 1px solid rgba(255, 255, 255, 0.1);
		padding: 9px 10px;
		cursor: pointer;
	}
	.cell:last-child {
		border-right: 0;
	}
	.count {
		margin-left: 5px;
		color: var(--color-text-dim);
	}
	.active {
		color: var(--color-accent);
		background: var(--color-accent-tint);
	}
	.active .count {
		color: var(--color-accent-muted);
	}
	.active::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		background: var(--color-accent);
	}
	@media (hover: hover) {
		.cell:not(.active):hover {
			background: var(--color-lift);
		}
	}
	@media (max-width: 719px) {
		.cell {
			min-height: 44px;
		}
	}
</style>
