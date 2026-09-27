<svelte:options runes={true} />

<script>
	// @ts-nocheck -- ported from liquidx-japan-train-lines (untyped JS)
	import { Play, Pause } from '@lucide/svelte';
	import { formatClock, SERVICE_START, SERVICE_END } from './schedule.js';

	// Play/pause, clock scrubber and speed presets for the schedule animation.
	// Rendered in the LineSelector's footer slot so it stays visible when the
	// panel is collapsed.
	let { playing = $bindable(), clockSec = $bindable(), speed = $bindable() } = $props();

	const SPEEDS = [1, 60, 120, 300, 600];

	const scrub = (e) => {
		clockSec = Number(e.target.value);
	};
</script>

<div class="flex flex-none flex-col gap-1.5 border-t border-tl-border px-2.5 py-2">
	<div class="flex items-center gap-2">
		<button
			class="flex w-6 flex-none cursor-pointer items-center justify-center border-none bg-transparent text-tl-primary"
			onclick={() => (playing = !playing)}
			aria-label={playing ? '一時停止' : '再生'}
		>
			{#if playing}
				<Pause size={13} strokeWidth={2.5} />
			{:else}
				<Play size={13} strokeWidth={2.5} />
			{/if}
		</button>
		<div class="min-w-11 text-xs font-bold text-tl-primary tabular-nums">
			{formatClock(clockSec)}
		</div>
		<input
			class="min-w-0 flex-1 accent-[var(--tl-accent-secondary)]"
			type="range"
			min={SERVICE_START}
			max={SERVICE_END}
			step="60"
			value={clockSec}
			oninput={scrub}
		/>
	</div>
	<div class="flex items-center gap-1">
		{#each SPEEDS as s (s)}
			<button
				class="rounded-md flex-1 cursor-pointer border border-tl-border py-1 text-micro {speed === s
					? 'bg-tl-selected-background text-tl-accent-primary'
					: 'bg-[var(--tl-surface-soft)] text-tl-secondary'}"
				onclick={() => (speed = s)}>×{s}</button
			>
		{/each}
	</div>
</div>
