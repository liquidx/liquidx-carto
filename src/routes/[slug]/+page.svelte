<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import StatusToken from '$lib/components/StatusToken.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.tool.title} · Carto</title></svelte:head>

<section class="head">
	<h1>{data.tool.title}</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
		<StatusToken state="pending">in development</StatusToken>
	</div>
	<p>{data.tool.summary}</p>
	<Button href={resolve('/')}>← all tools</Button>
</section>

<style>
	.head {
		padding: 96px 0 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 18px;
	}
	h1 {
		font-size: var(--text-screen);
		font-weight: 600;
		letter-spacing: var(--tracking-title);
		text-transform: uppercase;
		line-height: 1.4;
	}
	.meta {
		display: flex;
		gap: 18px;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	p {
		max-width: 560px;
		font-size: var(--text-content);
		color: var(--color-text-tertiary);
		margin-bottom: 12px;
	}
	@media (max-width: 719px) {
		.head {
			padding-top: 48px;
		}
	}
</style>
