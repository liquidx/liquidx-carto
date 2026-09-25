<!--
	Command/search field: accent `>` prompt · input · blinking accent block caret · ⏎ hint.
	The native caret is hidden; because the font is monospace the block caret is
	placed at selectionStart × 1ch.
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = {
		value?: string;
		placeholder?: string;
		hint?: string;
		onsubmit?: (value: string) => void;
	} & Omit<HTMLInputAttributes, 'value' | 'onsubmit'>;

	let { value = $bindable(''), placeholder, hint, onsubmit, ...rest }: Props = $props();

	let input: HTMLInputElement | undefined = $state();
	let focused = $state(false);
	let caretIndex = $state(0);
	let scrollLeft = $state(0);

	function syncCaret() {
		if (!input) return;
		caretIndex = input.selectionStart ?? value.length;
		scrollLeft = input.scrollLeft;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') onsubmit?.(value);
		queueMicrotask(syncCaret);
	}
</script>

<label class="field" class:focused>
	<span class="prompt" aria-hidden="true">&gt;</span>
	<span class="input-wrap">
		<input
			bind:this={input}
			bind:value
			{placeholder}
			spellcheck="false"
			autocomplete="off"
			{onkeydown}
			oninput={syncCaret}
			onkeyup={syncCaret}
			onclick={syncCaret}
			onselect={syncCaret}
			onscroll={syncCaret}
			onfocus={() => {
				focused = true;
				syncCaret();
			}}
			onblur={() => (focused = false)}
			{...rest}
		/>
		{#if focused}
			<span
				class="caret"
				aria-hidden="true"
				style:left="max(0px, calc({caretIndex}ch - {scrollLeft}px))"
			></span>
		{/if}
	</span>
	{#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
	.field {
		display: flex;
		align-items: center;
		gap: 9px;
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
		padding: 12px 14px;
		font-size: var(--text-body);
		cursor: text;
	}
	.focused {
		border-color: var(--color-accent);
	}
	.prompt {
		color: var(--color-accent);
		flex: none;
	}
	.input-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
	}
	input {
		width: 100%;
		font: inherit;
		color: var(--color-text);
		background: none;
		border: 0;
		outline: none;
		padding: 0;
		caret-color: transparent;
	}
	input::placeholder {
		color: var(--color-text-label);
	}
	.caret {
		position: absolute;
		top: 50%;
		width: 7px;
		height: 14px;
		margin-top: -7px;
		background: var(--color-accent);
		mix-blend-mode: screen;
		pointer-events: none;
		animation: var(--animate-caret);
	}
	.hint {
		flex: none;
		margin-left: auto;
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-micro);
		color: var(--color-text-dim);
	}
</style>
