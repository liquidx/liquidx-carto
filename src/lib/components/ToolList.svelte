<!--
	Spacious vertical list of tools: underlined title link with the date alongside in muted text.
	No bullets, no separators. Rows rise in once on load, staggered +60ms.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Tool } from '$lib/tools';

	type Props = { tools: Tool[] };

	let { tools }: Props = $props();
</script>

<ul class="tool-list">
	{#each tools as tool, i (tool.slug)}
		<li style:animation-delay="{i * 60}ms">
			<a href={resolve('/[slug]', { slug: tool.slug })}>{tool.title}</a>
			<time datetime={tool.date}>{tool.date}</time>
		</li>
	{/each}
</ul>

<style>
	.tool-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 16px;
		row-gap: 4px;
		animation: var(--animate-rise-in);
	}
	a {
		font-size: var(--text-list);
		color: var(--color-text);
		text-transform: lowercase;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 5px;
		text-decoration-color: var(--color-text-faint);
	}
	a:hover {
		text-decoration-color: var(--color-accent);
	}
	time {
		font-size: var(--text-small);
		color: var(--color-text-faint);
	}
</style>
