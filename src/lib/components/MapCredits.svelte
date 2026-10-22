<!-- Data acknowledgements for a full-bleed map: a small strip in the corner, like a map's attribution. -->
<script lang="ts">
	import type { Credit } from '$lib/credits';

	type Props = { credits: Credit[] };

	let { credits }: Props = $props();
</script>

<ul class="map-credits">
	{#each credits as c (c.name)}
		<li>
			<!-- external links, not app routes -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={c.url} target="_blank" rel="noopener">{c.name}</a>
			<span class="by">· {c.by}</span>
		</li>
	{/each}
</ul>

<style>
	.map-credits {
		position: absolute;
		right: 0;
		bottom: 0;
		z-index: 30;
		margin: 0;
		padding: 4px 8px;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 2px 12px;
		max-width: 100%;
		font-size: var(--text-meta);
		line-height: 1.5;
		color: var(--color-text-dim);
		background: rgba(8, 8, 10, 0.7);
		pointer-events: auto;
	}
	a {
		color: var(--color-text-faint);
		text-decoration: none;
	}
	@media (hover: hover) {
		a:hover {
			color: var(--color-accent);
		}
	}
	@media (max-width: 719px) {
		.by {
			display: none;
		}
	}
</style>
