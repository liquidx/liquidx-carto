<!-- Hairline chip; active = accent text + accent underline bar inset from the edges. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Props = { active?: boolean; children: Snippet } & HTMLButtonAttributes;

	let { active = false, children, ...rest }: Props = $props();
</script>

<button type="button" class="chip" class:active aria-pressed={active} {...rest}>
	{@render children()}
</button>

<style>
	.chip {
		position: relative;
		font-family: inherit;
		font-size: var(--text-meta);
		text-transform: lowercase;
		color: var(--color-text-tertiary);
		background: none;
		border: 1px solid var(--color-line);
		padding: 4px 9px;
		cursor: pointer;
	}
	.active {
		color: var(--color-accent);
	}
	.active::after {
		content: '';
		position: absolute;
		left: 6px;
		right: 6px;
		bottom: -1px;
		height: 2px;
		background: var(--color-accent);
	}
	@media (hover: hover) {
		.chip:hover {
			background: var(--color-lift);
		}
	}
</style>
