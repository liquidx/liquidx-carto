<!--
	Place search: PromptField that geocodes on ⏎ and lists matches below it. Picking one calls
	`onselect` and puts its name in the field.
-->
<script lang="ts">
	import PromptField from './PromptField.svelte';
	import { searchPlaces, type Place } from '$lib/contour/geocode';

	type Props = { onselect: (place: Place) => void; placeholder?: string };

	let { onselect, placeholder = 'search places' }: Props = $props();

	let query = $state('');
	let places = $state<Place[]>([]);
	let searching = $state(false);
	let error = $state('');

	async function search(q: string) {
		if (!q.trim() || searching) return;
		searching = true;
		error = '';
		try {
			places = await searchPlaces(q);
			if (!places.length) error = 'no places found';
		} catch (e) {
			error = (e as Error).message;
		} finally {
			searching = false;
		}
	}

	function pick(place: Place) {
		places = [];
		query = place.name;
		onselect(place);
	}
</script>

<div class="search">
	<PromptField
		{placeholder}
		hint={searching ? 'searching…' : '⏎ find'}
		bind:value={query}
		onsubmit={search}
	/>
	{#if places.length}
		<ul class="places">
			{#each places as place, i (i)}
				<li>
					<button type="button" onclick={() => pick(place)}>
						<span class="name">{place.name}</span>
						<span class="detail">{place.detail}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if error}<div class="error">{error}</div>{/if}
</div>

<style>
	.search {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.places {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.places button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: 8px 14px;
		font: inherit;
		text-align: left;
		background: none;
		border: 0;
		cursor: pointer;
	}
	.name {
		font-size: var(--text-content);
		color: var(--color-text);
	}
	.detail {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	@media (hover: hover) {
		.places button:hover {
			background: var(--color-lift);
		}
		.places button:hover .name {
			color: var(--color-accent);
		}
	}
	.error {
		font-size: var(--text-small);
		color: var(--color-danger);
	}
</style>
