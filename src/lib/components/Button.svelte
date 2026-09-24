<!--
	Square button. primary = accent text on accent tint + accent border ·
	neutral = hairline · danger = red text + red hairline. Renders <a> when href is set.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	type Props = {
		variant?: 'primary' | 'neutral' | 'danger';
		size?: 'sm' | 'md';
		href?: string;
		children: Snippet;
	} & HTMLButtonAttributes &
		HTMLAnchorAttributes;

	let { variant = 'neutral', size = 'md', href, children, ...rest }: Props = $props();
</script>

{#if href}
	<!-- callers pass an already-resolved href -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a {href} class="btn {variant} {size}" {...rest as HTMLAnchorAttributes}>{@render children()}</a>
{:else}
	<button type="button" class="btn {variant} {size}" {...rest as HTMLButtonAttributes}>
		{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		font-family: inherit;
		font-size: var(--text-small);
		line-height: 1.2;
		text-transform: lowercase;
		text-decoration: none;
		background: none;
		border: 1px solid var(--color-line-control);
		color: var(--color-text-ui);
		padding: 9px 14px;
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
	}
	.sm {
		font-size: var(--text-meta);
		padding: 6px 10px;
	}
	.primary {
		color: var(--color-accent);
		background: var(--color-accent-tint);
		border-color: var(--color-accent);
	}
	.danger {
		color: var(--color-danger);
		border-color: var(--color-danger-line);
	}
	@media (hover: hover) {
		.neutral:hover,
		.danger:hover {
			background: var(--color-lift);
		}
		.primary:hover {
			background: rgba(54, 182, 233, 0.16);
		}
	}
	.btn:disabled,
	.btn[aria-disabled='true'] {
		opacity: 0.4;
		cursor: not-allowed;
	}
	@media (max-width: 719px) {
		.btn {
			min-height: 44px;
		}
	}
</style>
