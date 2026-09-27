<svelte:options runes={true} />

<script>
	// @ts-nocheck -- ported from liquidx-japan-train-lines (untyped JS)
	import {
		ChevronDown,
		ChevronUp,
		Circle,
		Eye,
		EyeOff,
		Map,
		Minus,
		Moon,
		Palette,
		Plus,
		RotateCcw,
		Scan,
		SlidersHorizontal,
		Sun,
		List
	} from '@lucide/svelte';
	import { companyNameMapping, lineNameMapping } from '$lib/train-lines/line-name-mapping';
	import LineCell from '$lib/train-lines/LineCell.svelte';
	import ToggleOption from '$lib/train-lines/ToggleOption.svelte';

	let {
		// Line selection
		regions = [],
		trainCompanyNames = [],
		selectedRegion = null,
		selectedCompany = null,
		selectedLine = null,
		onselectregion,
		onselectcompany,
		onselectline,
		onselectfullregionmap,
		// Map appearance (used in mobile panel, desktop delegates to MapAppearanceControls)
		mapTheme = $bindable('dark'),
		showLineColors = $bindable(true),
		showBaseMapOutline = $bindable(true),
		forceShowStations = $bindable(false),
		stationSizeMultiplier = $bindable(1),
		showRegionPolygon = $bindable(false),
		schematicMode = $bindable(false),
		onzoomIn,
		onzoomOut,
		onreset,
		// Optional snippets: `footer` renders below the header bar (visible even
		// when collapsed); `appearanceExtra` replaces the appearance tab content.
		footer = null,
		appearanceExtra = null
	} = $props();

	let collapsed = $state(true);
	let activePanel = $state('lines'); // "lines" | "appearance"
	let expandedCompany = $state(null);

	$effect(() => {
		if (selectedCompany) {
			expandedCompany = selectedCompany;
		} else {
			expandedCompany = null;
		}
	});

	const handleCompanyClick = (companyName) => {
		if (selectedCompany === companyName) {
			expandedCompany = expandedCompany === companyName ? null : companyName;
		} else {
			onselectcompany?.(companyName);
		}
	};

	const linePrimaryName = (line) => {
		if (lineNameMapping[line] && lineNameMapping[line].ja) {
			return lineNameMapping[line].ja;
		}
		return line;
	};

	const companyPrimaryName = (company) => {
		if (companyNameMapping[company] && companyNameMapping[company].ja) {
			return companyNameMapping[company].ja;
		}
		return company;
	};

	const companyEnglishName = (company) => {
		return companyNameMapping[company]?.en ?? null;
	};
</script>

<!-- Floating panel — bottom on mobile, top-left on desktop -->
<div
	class="hud-controls absolute right-3
    bottom-3 left-3 z-10
    md:top-5 md:right-auto md:bottom-auto md:left-5 md:w-72"
	ontouchstart={(e) => e.stopPropagation()}
	ontouchmove={(e) => e.stopPropagation()}
	ontouchend={(e) => e.stopPropagation()}
	onwheel={(e) => e.stopPropagation()}
>
	<div
		class="rounded-xl flex flex-col overflow-hidden border border-tl-border bg-tl-panel-background shadow-[var(--tl-shadow-panel)] backdrop-blur-md transition-colors duration-200
      {collapsed ? '' : 'max-h-[70vh] md:max-h-[80vh]'}"
	>
		<!-- Header bar (always visible) -->
		<div class="flex h-10 w-full shrink-0 items-center bg-[var(--tl-surface-soft)]">
			<!-- Collapse / expand toggle -->
			<button
				class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 transition-colors duration-200 hover:bg-[var(--tl-surface-hover)]"
				onclick={() => (collapsed = !collapsed)}
				aria-expanded={!collapsed}
			>
				<Map size={15} strokeWidth={2.3} class="shrink-0 text-[var(--tl-accent-primary)]" />
				<span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left">
					{#if selectedCompany}
						<span class="truncate text-[11px] font-medium text-tl-accent-secondary"
							>{companyPrimaryName(selectedCompany)}</span
						>
						{#if selectedLine}
							<span class="shrink-0 text-[10px] text-tl-muted">→</span>
							<span class="truncate text-[11px] text-tl-secondary"
								>{linePrimaryName(selectedLine)}</span
							>
						{/if}
					{:else}
						<span
							class="text-[11px] font-medium tracking-[0.6px] text-[var(--tl-text-secondary)] uppercase"
						>
							{regions.find((r) => r.id === selectedRegion)?.nameJa || '路線を選択'}
						</span>
					{/if}
				</span>
				<ChevronDown
					size={13}
					strokeWidth={2.5}
					class="shrink-0 text-tl-muted transition-transform duration-200 {collapsed
						? ''
						: 'rotate-180'}"
				/>
			</button>

			<!-- Zoom buttons — always visible in header -->
			<div class="flex h-7 items-center gap-0.5 border-l border-tl-border pr-1.5 pl-1">
				<button
					onclick={(e) => {
						e.stopPropagation();
						schematicMode = !schematicMode;
					}}
					title="Schematic View"
					aria-label="Schematic View"
					aria-pressed={schematicMode}
					class="rounded-md flex h-7 w-7 cursor-pointer items-center justify-center transition-all duration-200
            {schematicMode
						? 'bg-[var(--tl-accent-primary-soft)] text-tl-accent-primary'
						: 'text-tl-muted hover:bg-[var(--tl-surface-hover)] hover:text-tl-accent-secondary'}"
				>
					<List size={14} strokeWidth={2.5} />
				</button>
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

		{@render footer?.()}

		{#if !collapsed}
			<!-- Tab switcher -->
			<div class="flex shrink-0 border-b border-tl-border bg-[var(--tl-panel-muted)]">
				<button
					class="flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 text-[11px] font-medium transition-colors duration-200
            {activePanel === 'lines'
						? 'border-b-2 border-[var(--tl-accent-primary)] text-tl-accent-primary'
						: 'text-tl-muted hover:text-tl-secondary'}"
					onclick={() => (activePanel = 'lines')}
				>
					<Map size={12} strokeWidth={2.3} />
					Lines
				</button>
				<button
					class="flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 text-[11px] font-medium transition-colors duration-200
            {activePanel === 'appearance'
						? 'border-b-2 border-[var(--tl-accent-primary)] text-tl-accent-primary'
						: 'text-tl-muted hover:text-tl-secondary'}"
					onclick={() => (activePanel = 'appearance')}
				>
					<SlidersHorizontal size={12} strokeWidth={2.3} />
					Appearance
				</button>
			</div>

			<!-- Lines panel -->
			<div class="{activePanel === 'lines' ? 'flex' : 'hidden'} flex-1 flex-col overflow-hidden">
				<!-- Scrollable accordion (regions + companies) -->
				<div class="flex-1 scrollbar-thin overflow-y-auto">
					<!-- Region grid -->
					<div class="grid grid-cols-2 gap-1 border-b border-tl-border p-2">
						{#each regions as r (r.id)}
							<button
								class="rounded-lg flex cursor-pointer flex-col items-start px-2.5 py-1.5 text-left transition-all duration-200
                  {selectedRegion === r.id
									? 'bg-[var(--tl-accent-primary-soft)] text-tl-accent-primary'
									: 'text-tl-muted hover:bg-[var(--tl-surface-hover)] hover:text-tl-secondary'}"
								onclick={() => onselectregion?.(r.id)}
							>
								<span
									class="text-xs leading-tight font-medium {selectedRegion === r.id
										? 'text-tl-accent-primary'
										: ''}">{r.nameJa}</span
								>
								<span class="text-micro leading-tight text-tl-muted">{r.name}</span>
							</button>
						{/each}
					</div>
					<button
						class="w-full border-b border-tl-border px-4 py-2.5 text-left transition-colors duration-150
              {selectedCompany === null && selectedLine === null
							? 'bg-[var(--tl-accent-primary-soft)] text-tl-accent-primary'
							: 'text-tl-secondary hover:bg-[var(--tl-surface-hover)]'}"
						onclick={() => onselectfullregionmap?.()}
					>
						<span class="text-sm font-medium">
							{regions.find((r) => r.id === selectedRegion)?.nameJa || '全国'}
						</span>
						<span class="ml-2 text-micro text-tl-muted">All regional lines</span>
					</button>

					{#each trainCompanyNames as company (company.company)}
						<div class="border-b border-tl-border">
							<button
								class="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors duration-150
                  {selectedCompany === company.company
									? 'bg-[var(--tl-accent-primary-soft)] text-tl-accent-primary'
									: 'text-tl-secondary hover:bg-[var(--tl-surface-hover)]'}"
								onclick={() => handleCompanyClick(company.company)}
							>
								<span class="flex min-w-0 flex-col truncate">
									<span class="truncate text-sm font-medium"
										>{companyPrimaryName(company.company)}</span
									>
									{#if companyEnglishName(company.company)}
										<span class="truncate text-micro text-tl-muted"
											>{companyEnglishName(company.company)}</span
										>
									{/if}
								</span>
								<span class="ml-2 flex shrink-0 items-center gap-1.5">
									<span class="text-micro text-tl-muted">{company.lines.length}</span>
									{#if expandedCompany === company.company}
										<ChevronUp size={14} class="text-tl-muted" />
									{:else}
										<ChevronDown size={14} class="text-tl-muted" />
									{/if}
								</span>
							</button>

							{#if expandedCompany === company.company}
								<div class="grid grid-cols-2 gap-1.5 bg-[var(--tl-surface-soft)] px-3 py-2">
									{#each company.lines as line (line)}
										<LineCell
											{line}
											company={selectedCompany}
											selected={selectedLine === line}
											onclick={() => onselectline?.({ company: selectedCompany, line })}
										/>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- Appearance panel -->
			<div
				class="{activePanel === 'appearance'
					? 'flex'
					: 'hidden'} flex-1 scrollbar-thin flex-col overflow-y-auto"
			>
				{#if appearanceExtra}
					{@render appearanceExtra()}
				{:else}
					<div class="p-2">
						<!-- Theme toggle -->
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
								<span class="text-xs font-medium text-[var(--tl-text-secondary)]">Station size</span
								>
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
		{/if}
	</div>
</div>
