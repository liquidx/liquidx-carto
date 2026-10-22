<!--
	Command/search field: accent `>` prompt · input · blinking accent block caret · ⏎ hint.
	The native caret is hidden; because the font is monospace the block caret is
	placed at selectionStart × 1ch. It is a form, so a phone keyboard offers a search key
	instead of jumping to the next field, and the hint is a button that submits when tapped.
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

	function onkeydown() {
		queueMicrotask(syncCaret);
	}
	function submit(e: SubmitEvent) {
		e.preventDefault();
		onsubmit?.(value);
	}
</script>

<form
	class="field"
	class:focused
	onsubmit={submit}
	onpointerdown={(e) => {
		// The whole field is a click target for the input, as a label would be.
		if (e.target === e.currentTarget) {
			e.preventDefault();
			input?.focus();
		}
	}}
>
	<span class="prompt" aria-hidden="true">&gt;</span>
	<span class="input-wrap">
		<input
			bind:this={input}
			bind:value
			{placeholder}
			spellcheck="false"
			autocomplete="off"
			enterkeyhint="search"
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
	{#if hint}<button type="submit" class="hint">{hint}</button>{/if}
</form>

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
		padding: 0;
		font: inherit;
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-micro);
		color: var(--color-text-dim);
		background: none;
		border: 0;
		cursor: pointer;
	}
	.hint:hover {
		color: var(--color-accent);
	}
</style>
