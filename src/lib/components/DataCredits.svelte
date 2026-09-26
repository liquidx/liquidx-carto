<!-- Acknowledgements for the data a tool uses: name (linked), publisher, and what it's used for. -->
<script lang="ts">
	import SectionLabel from './SectionLabel.svelte';
	import type { Credit } from '$lib/credits';

	type Props = { credits: Credit[] };

	let { credits }: Props = $props();
</script>

<section class="credits">
	<SectionLabel label="Data" descriptor="with thanks" />
	<ul>
		{#each credits as c (c.name)}
			<li>
				<!-- external links, not app routes -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={c.url} target="_blank" rel="noopener">{c.name}</a>
				<span class="by">{c.by}</span>
				<span class="use">{c.use}</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.credits {
		margin-top: 96px;
	}
	ul {
		list-style: none;
		margin: 24px 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
		gap: 20px 48px;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	a {
		font-size: var(--text-small);
		color: var(--color-text-secondary);
		text-decoration: none;
	}
	@media (hover: hover) {
		a:hover {
			color: var(--color-accent);
		}
	}
	.by {
		font-size: var(--text-meta);
		line-height: 1.6;
		color: var(--color-text-faint);
	}
	.use {
		font-size: var(--text-meta);
		color: var(--color-text-dim);
	}
</style>
