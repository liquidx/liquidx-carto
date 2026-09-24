<!-- Top rail: CARTO wordmark (links home) and an optional `/ crumb`. No nav, no sidebar. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import TickStrip from './TickStrip.svelte';

	type Props = { crumb?: string };

	let { crumb }: Props = $props();
</script>

<header class="site-header">
	<div class="rail">
		<a class="wordmark" href={resolve('/')}>CARTO</a>
		{#if crumb}
			<span class="sep" aria-hidden="true">/</span>
			<span class="crumb">{crumb}</span>
		{/if}
	</div>
	<TickStrip mobileOnly />
</header>

<style>
	.site-header {
		border-bottom: 1px solid var(--color-line);
	}
	.rail {
		max-width: var(--container-content);
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 var(--spacing-gutter);
		height: 56px;
	}
	.wordmark {
		font-size: var(--text-small);
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--color-text);
		text-decoration: none;
	}
	.sep {
		color: var(--color-bar-track);
		font-size: var(--text-small);
	}
	.crumb {
		font-size: var(--text-small);
		color: var(--color-text-label);
		text-transform: lowercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	@media (max-width: 719px) {
		.site-header {
			border-bottom: 0;
		}
		.rail {
			padding: 0 var(--spacing-gutter-mobile);
		}
	}
</style>
