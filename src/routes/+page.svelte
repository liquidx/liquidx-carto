<script lang="ts">
	import ToolList from '$lib/components/ToolList.svelte';
	import { tools } from '$lib/tools';
</script>

<svelte:head><title>Carto</title></svelte:head>

<p class="intro">
	A sandbox for research into cartographic techniques, in digital and physical form. Tools of
	different complexity, all related to map making. By <a href="https://liquidx.net">@liquidx</a>.
</p>

<ToolList {tools} />

<style>
	.intro {
		padding: 96px 0 56px;
		max-width: 560px;
		font-size: var(--text-content);
		line-height: 1.7;
		color: var(--color-text-tertiary);
	}
	.intro a {
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 4px;
		text-decoration-color: var(--color-text-faint);
	}
	.intro a:hover {
		text-decoration-color: var(--color-accent);
	}
	@media (max-width: 719px) {
		.intro {
			padding: 48px 0 40px;
		}
	}
</style>
