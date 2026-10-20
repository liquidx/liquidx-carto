<!--
	Place search: PromptField that geocodes on ⏎ and lists matches in a popover under it, over
	the page rather than pushing it down. Picking one calls `onselect` and puts its name in the
	field; ↑ ↓ ⏎ pick from the list, esc or a click elsewhere closes it.
-->
<script lang="ts">
	import PromptField from './PromptField.svelte';
	import { searchPlaces, type Place } from '$lib/contour/geocode';

	type Props = { onselect: (place: Place) => void; placeholder?: string };

	let { onselect, placeholder = 'search places' }: Props = $props();

	let root: HTMLDivElement;
	let query = $state('');
	let places = $state<Place[]>([]);
	let searching = $state(false);
	let error = $state('');
	let open = $state(false);
	let active = $state(-1);

	async function search(q: string) {
		if (!q.trim() || searching) return;
		searching = true;
		error = '';
		try {
			places = await searchPlaces(q);
			if (!places.length) error = 'no places found';
		} catch (e) {
			places = [];
			error = (e as Error).message;
		} finally {
			searching = false;
			active = -1;
			open = true;
		}
	}

	function pick(place: Place) {
		open = false;
		places = [];
		query = place.name;
		onselect(place);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			// Closes the list and nothing else on the page.
			e.stopPropagation();
			open = false;
		} else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && places.length) {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = Math.min(places.length - 1, Math.max(0, active + step));
		} else if (e.key === 'Enter' && places[active]) {
			// Takes the highlighted place instead of searching again.
			e.preventDefault();
			e.stopPropagation();
			pick(places[active]);
		}
	}
</script>

<svelte:document
	onpointerdown={(e) => {
		if (open && !root.contains(e.target as Node)) open = false;
	}}
/>

<div
	class="search"
	bind:this={root}
	onkeydowncapture={onkeydown}
	onfocusin={() => {
		if (places.length || error) open = true;
	}}
	onfocusout={(e) => {
		if (e.relatedTarget && !root.contains(e.relatedTarget as Node)) open = false;
	}}
>
	<PromptField
		{placeholder}
		hint={searching ? 'searching…' : '⏎ find'}
		bind:value={query}
		onsubmit={search}
	/>
	{#if open && (places.length || error)}
		<div class="popover">
			{#if places.length}
				<ul class="places" role="listbox" aria-label="places found">
					{#each places as place, i (i)}
						<li role="option" aria-selected={i === active}>
							<button
								type="button"
								class:active={i === active}
								onclick={() => pick(place)}
								onpointerenter={() => (active = i)}
							>
								<span class="name">{place.name}</span>
								<span class="detail">{place.detail}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if error}<div class="error">{error}</div>{/if}
		</div>
	{/if}
</div>

<style>
	.search {
		position: relative;
	}
	.popover {
		position: absolute;
		z-index: 10;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 320px;
		overflow-y: auto;
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
	}
	.places {
		list-style: none;
		margin: 0;
		padding: 4px 0;
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
	.places button.active {
		background: var(--color-lift);
	}
	.places button.active .name {
		color: var(--color-accent);
	}
	.error {
		padding: 10px 14px;
		font-size: var(--text-small);
		color: var(--color-danger);
	}
</style>
