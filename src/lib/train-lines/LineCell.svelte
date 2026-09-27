<svelte:options runes={true} />

<script>
	// @ts-nocheck -- ported from liquidx-japan-train-lines (untyped JS)
	import { lineNameMapping } from '$lib/train-lines/line-name-mapping.js';
	import { getLineColor } from '$lib/train-lines/line-colors.js';

	let { line, company, selected = false, onclick } = $props();

	const dotColor = (c, l) => {
		const hex = getLineColor(c, l);
		return hex ?? 'var(--tl-text-faint)';
	};

	const linePrimaryName = (l) => {
		if (lineNameMapping[l] && lineNameMapping[l].ja) {
			return lineNameMapping[l].ja;
		}
		return l;
	};
</script>

<button
	class="group rounded-lg mb-1.5 flex w-full cursor-pointer flex-row flex-nowrap items-center justify-between gap-2 p-2 text-left text-tl-muted transition-all duration-200 hover:bg-tl-selected-background hover:text-tl-secondary {selected
		? 'border-[color:var(--tl-accent-secondary-border)] bg-[var(--tl-accent-secondary-soft)] text-[var(--tl-accent-tertiary)] shadow-[0_0_10px_var(--tl-accent-secondary-soft)]'
		: ''}"
	{onclick}
>
	<span class="flex min-w-0 flex-col">
		<span class="text-sm font-medium">{linePrimaryName(line)}</span>
		{#if lineNameMapping[line]?.en}
			<span class="mt-[1px] text-[10px] opacity-60">{lineNameMapping[line].en}</span>
		{/if}
	</span>
	<span
		class="h-2 w-2 shrink-0 rounded-full transition-all duration-200 group-hover:scale-125"
		style="background-color: {dotColor(company, line)}"
	></span>
</button>
