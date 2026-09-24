<!--
	Lowercase state word, colored by state — accent ok · amber pending · faint off.
	No dot or mark beside it: we never put a colored dot next to text.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { state?: 'ok' | 'pending' | 'off'; children: Snippet };

	let { state = 'ok', children }: Props = $props();
</script>

<span class="token {state}">{@render children()}</span>

<style>
	.token {
		font-size: var(--text-meta);
		letter-spacing: 0.08em;
		text-transform: lowercase;
		white-space: nowrap;
	}
	.ok {
		color: var(--color-accent);
	}
	.pending {
		color: var(--color-warn);
	}
	.off {
		color: var(--color-text-faint);
	}
</style>
