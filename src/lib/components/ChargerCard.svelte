<!-- One charging site: name, labelled detail rows, access tokens and a maps link. -->
<script lang="ts">
	import StatusToken from './StatusToken.svelte';
	import { chargeTypes, type Charger } from '$lib/ev/model';

	type Props = { charger: Charger };

	let { charger: c }: Props = $props();

	const rows = $derived(
		[
			['type', chargeTypes(c).join(' · ')],
			['hours', c.hours],
			['address', c.address],
			['notes', c.notes]
		].filter(([, v]) => v)
	);
</script>

<div class="card">
	<div class="name">{c.name}</div>
	<dl>
		{#each rows as [k, v] (k)}
			<dt>{k}</dt>
			<dd>{v}</dd>
		{/each}
	</dl>
	<div class="tokens">
		{#if c.open24h}<StatusToken state="ok">24h</StatusToken>{/if}
		{#if c.cardRequired}<StatusToken state="pending">card / app</StatusToken>{/if}
		{#if c.emp}<StatusToken state="off">emp</StatusToken>{/if}
		{#if c.tesla}<StatusToken state="off">tesla</StatusToken>{/if}
	</div>
	<a
		class="link"
		href="https://www.google.com/maps/search/?api=1&query={c.lat},{c.lon}"
		target="_blank"
		rel="noopener">open in google maps →</a
	>
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 280px;
	}
	.name {
		padding-right: 16px;
		font-size: var(--text-content);
		line-height: 1.5;
		color: var(--color-text);
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 14px;
		font-size: var(--text-small);
		line-height: 1.55;
	}
	dt {
		padding-top: 1px;
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	dd {
		margin: 0;
		color: var(--color-text-secondary);
	}
	.tokens {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	.tokens:empty {
		display: none;
	}
	.link {
		font-size: var(--text-meta);
		color: var(--color-text-tertiary);
		text-decoration: none;
	}
	.link:hover {
		color: var(--color-accent);
	}
</style>
