<!--
	Select with a search: the box opens a list under it, and a field above the list narrows it
	down as you type. ↑ ↓ move through the matches, ⏎ picks, esc closes. An option's `mark` sits
	at the right of its row.
-->
<script lang="ts" generics="T extends string">
	import { tick } from 'svelte';

	type Option = { value: T; label?: string; mark?: string };
	type Props = {
		options: Option[];
		value?: T;
		label?: string;
		/** Shown in the box while nothing is picked. */
		placeholder?: string;
		searchPlaceholder?: string;
		onchange?: (value: T) => void;
	};

	let {
		options,
		value = $bindable(),
		label,
		placeholder = 'choose',
		searchPlaceholder = 'search',
		onchange
	}: Props = $props();

	const id = $props.id();

	let open = $state(false);
	let query = $state('');
	/** The match the keyboard or pointer is on. */
	let active = $state(0);
	let root: HTMLElement;
	let trigger: HTMLButtonElement;
	let search = $state<HTMLInputElement>();
	let list = $state<HTMLElement>();

	const selected = $derived(options.find((o) => o.value === value));
	/** Options with every typed word somewhere in their label. */
	const matches = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return options;
		return options.filter((o) => {
			const text = (o.label ?? o.value).toLowerCase();
			return words.every((w) => text.includes(w));
		});
	});

	/** Scrolls the list just far enough to show the active match. */
	async function reveal() {
		await tick();
		const el = list?.children[active] as HTMLElement | undefined;
		if (!list || !el) return;
		if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
		else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
			list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
	}

	async function show() {
		query = '';
		active = Math.max(0, options.indexOf(selected!));
		open = true;
		await reveal();
		// A touch keyboard would cover the list: there the search waits to be tapped.
		if (!matchMedia('(pointer: coarse)').matches) search?.focus();
	}
	function hide() {
		open = false;
	}
	function pick(opt: Option) {
		hide();
		trigger.focus();
		if (opt.value === value) return;
		value = opt.value;
		onchange?.(opt.value);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				show();
			}
			return;
		}
		if (e.key === 'Escape') {
			// Closes the list and nothing else on the page.
			e.stopPropagation();
			hide();
			trigger.focus();
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = Math.min(matches.length - 1, Math.max(0, active + step));
			reveal();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (matches[active]) pick(matches[active]);
		}
	}
</script>

<svelte:document
	onpointerdown={(e) => {
		if (open && !root.contains(e.target as Node)) hide();
	}}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="combobox"
	bind:this={root}
	{onkeydown}
	onfocusout={(e) => {
		if (e.relatedTarget && !root.contains(e.relatedTarget as Node)) hide();
	}}
>
	{#if label}<span class="label" id="{id}-label">{label}</span>{/if}
	<div class="box">
		<button
			type="button"
			class="trigger"
			class:empty={!selected}
			bind:this={trigger}
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-labelledby={label ? `${id}-label ${id}-value` : undefined}
			onclick={() => (open ? hide() : show())}
		>
			<span class="value" id="{id}-value">
				{selected ? (selected.label ?? selected.value) : placeholder}
			</span>
			<span class="marker" aria-hidden="true">▾</span>
		</button>
		{#if open}
			<div class="popover">
				<label class="search">
					<span class="prompt" aria-hidden="true">&gt;</span>
					<input
						bind:this={search}
						bind:value={query}
						placeholder={searchPlaceholder}
						role="combobox"
						aria-label={searchPlaceholder}
						aria-expanded="true"
						aria-controls="{id}-list"
						aria-activedescendant={matches[active] ? `${id}-${active}` : undefined}
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
						enterkeyhint="done"
						oninput={() => {
							active = 0;
							reveal();
						}}
					/>
				</label>
				<div class="list" id="{id}-list" role="listbox" bind:this={list}>
					{#each matches as opt, i (opt.value)}
						<button
							type="button"
							role="option"
							id="{id}-{i}"
							tabindex="-1"
							class:active={i === active}
							aria-selected={opt.value === value}
							onpointermove={() => (active = i)}
							onclick={() => pick(opt)}
						>
							<span class="name">{opt.label ?? opt.value}</span>
							{#if opt.mark}<span class="mark">{opt.mark}</span>{/if}
						</button>
					{:else}
						<div class="none">no matches</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.combobox {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.box {
		position: relative;
		display: flex;
	}
	.trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		font: inherit;
		font-size: var(--text-small);
		text-transform: lowercase;
		text-align: left;
		color: var(--color-text-ui);
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
		height: var(--control-height);
		padding: 0 12px;
		cursor: pointer;
	}
	.trigger:focus-visible,
	.trigger[aria-expanded='true'] {
		outline: none;
		border-color: var(--color-accent);
	}
	.trigger.empty .value {
		color: var(--color-text-label);
	}
	.value {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.marker {
		flex: none;
		font-size: var(--text-meta);
		color: var(--color-accent);
	}
	.popover {
		position: absolute;
		z-index: 10;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 11px 12px 9px;
		font-size: var(--text-small);
		cursor: text;
	}
	.prompt {
		flex: none;
		color: var(--color-accent);
	}
	input {
		flex: 1;
		min-width: 0;
		font: inherit;
		color: var(--color-text);
		background: none;
		border: 0;
		outline: none;
		padding: 0;
		caret-color: var(--color-accent);
		/* A page that turns selection off must not take typing with it. */
		user-select: text;
		-webkit-user-select: text;
	}
	input::placeholder {
		color: var(--color-text-label);
	}
	.list {
		position: relative;
		display: flex;
		flex-direction: column;
		max-height: min(264px, 40vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding-bottom: 4px;
	}
	.list button {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font: inherit;
		font-size: var(--text-small);
		text-transform: lowercase;
		text-align: left;
		color: var(--color-text-ui);
		background: none;
		border: 0;
		padding: 7px 12px;
		cursor: pointer;
	}
	.list button.active {
		background: var(--color-lift);
		color: var(--color-text);
	}
	.list button[aria-selected='true'] {
		color: var(--color-accent);
	}
	.mark {
		flex: none;
		font-size: var(--text-body);
		line-height: 1;
		letter-spacing: 2px;
		color: var(--color-text-secondary);
	}
	.none {
		padding: 7px 12px;
		font-size: var(--text-small);
		color: var(--color-text-faint);
	}
	@media (max-width: 719px) {
		.trigger {
			min-height: 44px;
		}
		.list button {
			padding: 12px;
		}
	}
</style>
