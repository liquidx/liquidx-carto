<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import { findTool } from '$lib/tools';

	let { children } = $props();

	const crumb = $derived(page.params.slug ? findTool(page.params.slug)?.title : undefined);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<SiteHeader {crumb} />
<main>
	{@render children()}
</main>

<style>
	main {
		max-width: var(--container-content);
		margin: 0 auto;
		padding: 0 var(--spacing-gutter) 120px;
	}
	@media (max-width: 719px) {
		main {
			padding: 0 var(--spacing-gutter-mobile) 80px;
		}
	}
</style>
