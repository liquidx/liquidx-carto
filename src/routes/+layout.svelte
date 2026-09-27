<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import { findTool } from '$lib/tools';

	let { children } = $props();

	// Full-bleed pages (a load returning `fullBleed: true`) fill the viewport
	// below the header and carry no heading of their own, so the crumb names them.
	const bleed = $derived(page.data.fullBleed === true);
	const crumb = $derived(
		page.params.slug ? findTool(page.params.slug)?.title : bleed ? page.data.tool?.title : undefined
	);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="shell" class:bleed>
	<SiteHeader {crumb} />
	<main>
		{@render children()}
	</main>
</div>

<style>
	main {
		max-width: var(--container-content);
		margin: 0 auto;
		padding: 0 var(--spacing-gutter) 120px;
	}
	.bleed {
		display: flex;
		flex-direction: column;
		height: 100dvh;
	}
	.bleed main {
		position: relative;
		flex: 1;
		min-height: 0;
		width: 100%;
		max-width: none;
		padding: 0;
	}
	@media (max-width: 719px) {
		main {
			padding: 0 var(--spacing-gutter-mobile) 80px;
		}
		.bleed main {
			padding: 0;
		}
	}
</style>
