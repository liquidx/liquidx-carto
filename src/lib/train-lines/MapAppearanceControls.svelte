<svelte:options runes={true} />

<script>
	// @ts-nocheck -- ported from liquidx-japan-train-lines (untyped JS)
	import {
		ChevronUp,
		Circle,
		Eye,
		EyeOff,
		Minus,
		Moon,
		Palette,
		Plus,
		RotateCcw,
		SlidersHorizontal,
		Sun,
		Scan
	} from '@lucide/svelte';
	import ToggleOption from '$lib/train-lines/ToggleOption.svelte';

	let {
		mapTheme = $bindable('dark'),
		showLineColors = $bindable(true),
		showBaseMapOutline = $bindable(true),
		forceShowStations = $bindable(false),
		stationSizeMultiplier = $bindable(1),
		showRegionPolygon = $bindable(false),
		onzoomIn,
		onzoomOut,
		onreset
	} = $props();

	let collapsed = $state(true);
</script>

<!-- Map Appearance Panel (bottom-right, collapsible) with zoom controls in header -->
<div
	class="hud-controls absolute right-5 bottom-5 z-10 hidden max-w-84 md:block"
	role="presentation"
	ontouchstart={(e) => e.stopPropagation()}
	ontouchmove={(e) => e.stopPropagation()}
	ontouchend={(e) => e.stopPropagation()}
>
	<div
		class="rounded-xl overflow-hidden border border-tl-border bg-tl-panel-background shadow-[var(--tl-shadow-panel)] backdrop-blur-md transition-colors duration-200"
	>
		<div
			class="flex h-10 w-full items-center bg-[var(--tl-surface-soft)] transition-colors duration-200 hover:bg-[var(--tl-surface-hover)]"
		>
			<button
				class="flex h-full flex-1 cursor-pointer items-center gap-2 px-3"
				onclick={() => (collapsed = !collapsed)}
				aria-expanded={!collapsed}
			>
				<SlidersHorizontal size={15} strokeWidth={2.3} class="text-[var(--tl-accent-tertiary)]" />
				<h2
					class="m-0 flex-1 text-left text-[11px] font-medium tracking-[0.6px] text-[var(--tl-text-secondary)] uppercase"
				>
					Map Appearance
				</h2>
				<ChevronUp
					size={13}
					strokeWidth={2.5}
					class="text-tl-muted transition-transform duration-200 {collapsed ? 'rotate-180' : ''}"
				/>
			</button>
			<div class="flex h-7 items-center gap-0.5 border-l border-tl-border pr-1.5 pl-1">
				<button
					onclick={(e) => {
						e.stopPropagation();
						onzoomIn?.();
					}}
					title="Zoom In"
					aria-label="Zoom In"
					class="rounded-md flex h-7 w-7 cursor-pointer items-center justify-center border-none bg-transparent text-tl-muted transition-all duration-200 hover:bg-[var(--tl-surface-hover)] hover:text-tl-accent-secondary active:bg-[var(--tl-accent-secondary-soft)] active:text-tl-accent-secondary"
				>
					<Plus size={14} strokeWidth={2.5} />
				</button>
				<button
					onclick={(e) => {
						e.stopPropagation();
						onzoomOut?.();
					}}
					title="Zoom Out"
					aria-label="Zoom Out"
					class="rounded-md flex h-7 w-7 cursor-pointer items-center justify-center border-none bg-transparent text-tl-muted transition-all duration-200 hover:bg-[var(--tl-surface-hover)] hover:text-tl-accent-secondary active:bg-[var(--tl-accent-secondary-soft)] active:text-tl-accent-secondary"
				>
					<Minus size={14} strokeWidth={2.5} />
				</button>
				<button
					onclick={(e) => {
						e.stopPropagation();
						onreset?.();
					}}
					title="Reset View"
					aria-label="Reset View"
					class="rounded-md flex h-7 w-7 cursor-pointer items-center justify-center border-none bg-transparent text-tl-muted transition-all duration-200 hover:bg-[var(--tl-surface-hover)] hover:text-tl-accent-secondary active:bg-[var(--tl-accent-secondary-soft)] active:text-tl-accent-secondary"
				>
					<RotateCcw size={13} strokeWidth={2.5} />
				</button>
			</div>
		</div>

		{#if !collapsed}
			<div class="p-2">
				<div
					class="rounded-lg mb-1 grid grid-cols-2 gap-1 border border-tl-border bg-[var(--tl-surface-soft)] p-1"
				>
					<button
						class="rounded-md flex h-8 cursor-pointer items-center justify-center gap-1.5 border border-transparent text-[11px] font-medium transition-all duration-200 {mapTheme ===
						'dark'
							? 'border-tl-border bg-[var(--tl-accent-primary-soft)] text-tl-accent-primary'
							: 'text-tl-muted hover:bg-[var(--tl-surface-hover)]'}"
						onclick={() => (mapTheme = 'dark')}
						aria-pressed={mapTheme === 'dark'}
					>
						<Moon size={14} strokeWidth={2.2} />
						Dark
					</button>
					<button
						class="rounded-md flex h-8 cursor-pointer items-center justify-center gap-1.5 border border-transparent text-[11px] font-medium transition-all duration-200 {mapTheme ===
						'light'
							? 'border-tl-border bg-[var(--tl-accent-primary-soft)] text-tl-accent-primary'
							: 'text-tl-muted hover:bg-[var(--tl-surface-hover)]'}"
						onclick={() => (mapTheme = 'light')}
						aria-pressed={mapTheme === 'light'}
					>
						<Sun size={14} strokeWidth={2.2} />
						Light
					</button>
				</div>

				<ToggleOption
					bind:checked={showLineColors}
					label="Line colors"
					description=""
					color="var(--tl-accent-primary)"
				>
					<Palette
						size={16}
						strokeWidth={2.2}
						class={showLineColors ? 'text-tl-primary' : 'text-tl-muted'}
					/>
				</ToggleOption>

				<ToggleOption
					bind:checked={showBaseMapOutline}
					label="Base map outline"
					description=""
					color="var(--tl-accent-tertiary)"
				>
					{#if showBaseMapOutline}
						<Eye size={16} strokeWidth={2.2} class="text-[var(--tl-accent-tertiary)]" />
					{:else}
						<EyeOff size={16} strokeWidth={2.2} class="text-tl-muted" />
					{/if}
				</ToggleOption>

				<ToggleOption
					bind:checked={forceShowStations}
					label="Stations"
					description=""
					color="var(--tl-accent-secondary)"
				>
					<Circle
						size={16}
						strokeWidth={2.2}
						class={forceShowStations ? 'text-[var(--tl-accent-secondary)]' : 'text-tl-muted'}
					/>
				</ToggleOption>

				<div class="px-2.5 py-2">
					<div class="mb-1.5 flex items-center justify-between">
						<span class="text-xs font-medium text-[var(--tl-text-secondary)]">Station size</span>
						<span class="text-[10px] text-tl-muted tabular-nums"
							>{stationSizeMultiplier.toFixed(1)}×</span
						>
					</div>
					<input
						type="range"
						min="0.5"
						max="3"
						step="0.1"
						bind:value={stationSizeMultiplier}
						class="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--tl-switch-off)] accent-[var(--tl-accent-secondary)]"
					/>
					<div class="mt-1 flex justify-between">
						<span class="text-[9px] text-tl-muted">0.5×</span>
						<span class="text-[9px] text-tl-muted">3×</span>
					</div>
				</div>

				<div class="mt-1 border-t border-tl-border pt-1">
					<ToggleOption
						bind:checked={showRegionPolygon}
						label="Region polygon"
						description="Debug"
						color="var(--tl-accent-secondary)"
					>
						<Scan
							size={16}
							strokeWidth={2.2}
							class={showRegionPolygon ? 'text-[var(--tl-accent-secondary)]' : 'text-tl-muted'}
						/>
					</ToggleOption>
				</div>
			</div>
		{/if}
	</div>
</div>
