<svelte:options runes={true} />

<script>
	// @ts-nocheck -- ported from liquidx-japan-train-lines (untyped JS)
	import { companyNameMapping } from '$lib/train-lines/line-name-mapping.js';

	let { company, selected = false, onclick } = $props();

	const companyLinePrimaryName = (c) => {
		if (companyNameMapping[c] && companyNameMapping[c].ja) {
			return companyNameMapping[c].ja;
		}
		return c;
	};
</script>

<button
	class="rounded-lg mb-1.5 flex w-full cursor-pointer flex-row flex-nowrap items-center justify-between gap-2 p-2 text-left text-tl-muted transition-all duration-200 hover:bg-tl-selected-background hover:text-tl-secondary {selected
		? 'bg-tl-selected-background text-tl-accent-primary'
		: 'bg-transparent'}"
	{onclick}
>
	<div class="flex min-w-0 flex-col {selected ? 'text-tl-accent-primary' : 'text-tl-muted'}">
		<span class="text-sm font-medium">{companyLinePrimaryName(company.company)}</span>
		{#if companyNameMapping[company.company]?.en}
			<span class="text-micro">{companyNameMapping[company.company].en}</span>
		{/if}
	</div>
	<div
		class="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-tl-chip-background px-2 py-1 text-micro"
	>
		<span>{company.lines.length}</span>
	</div>
</button>
