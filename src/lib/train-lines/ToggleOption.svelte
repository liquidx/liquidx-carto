<svelte:options runes={true} />

<script>
	// @ts-nocheck -- ported from liquidx-japan-train-lines (untyped JS)
	let {
		checked = $bindable(false),
		label = '',
		description = '',
		color = 'var(--tl-accent-primary)',
		children
	} = $props();
</script>

<button
	class="rounded-lg flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 border border-transparent bg-transparent px-2.5 py-2 text-left transition-all duration-200 hover:border-tl-border hover:bg-[var(--tl-surface-hover)]"
	onclick={() => (checked = !checked)}
	aria-pressed={checked}
>
	<span class="flex min-w-0 items-center gap-2">
		<div class="w-6">
			{@render children?.()}
		</div>
		<span class="flex min-w-0 flex-col">
			<span class="text-xs font-medium text-[var(--tl-text-secondary)]">{label}</span>
			<span class="truncate text-micro text-tl-muted">{description}</span>
		</span>
	</span>
	<span
		class="relative h-4 w-8 shrink-0 rounded-full bg-[var(--tl-switch-off)] transition-colors duration-200"
		style={checked ? `background-color: ${color}` : null}
	>
		<span
			class="absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-[var(--tl-switch-knob)] transition-transform duration-200 {checked
				? 'translate-x-4'
				: 'translate-x-0'}"
		></span>
	</span>
</button>
