<!--
	Snowboard down a real resort: GSI 1 m lidar terrain streamed round the rider, the runs,
	lifts and forest laid out from the resort's GeoJSON. Keyboard to ride, lifts to get back up.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Select from '$lib/components/Select.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { PROVIDERS } from '$lib/contour/terrain-api';
	import { CREDITS, type Credit } from '$lib/credits';
	import { createGame, type Game, type Hud, type LoadProgress } from '$lib/snowboard/game';
	import Minimap from '$lib/snowboard/Minimap.svelte';
	import { DIFFICULTY_COLOR } from '$lib/snowboard/resort';

	let { data } = $props();

	let canvas: HTMLCanvasElement;
	let labelHost: HTMLElement;
	let game = $state.raw<Game | null>(null);
	let progress = $state<LoadProgress>({ stage: 'loading' });
	let message = $state('');
	let hud = $state.raw<Hud | null>(null);
	/** The start screen shows before the first run and whenever the game is paused. */
	let menu = $state(true);
	let started = $state(false);
	let liftId = $state('');
	/** A touch screen: on-screen controls and lighter rendering. `?touch` forces it, for testing. */
	const coarse =
		typeof window !== 'undefined' &&
		(matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch'));
	let shadows = $state(!coarse);

	const lifts = $derived(game?.lifts ?? []);
	const provider = PROVIDERS.find((p) => p.id === 'gsi-1m')!;

	onMount(() => {
		let g: Game | undefined;
		createGame(
			canvas,
			data.features,
			{
				provider: provider.id,
				shadows,
				labels: labelHost,
				woods: data.woods,
				treeSpacing: coarse ? 18 : 14,
				maxPixelRatio: coarse ? 1.5 : 2
			},
			(p) => (progress = p),
			(h) => (hud = h)
		)
			.then((created) => {
				g = created;
				game = created;
				if (import.meta.env.DEV) (window as unknown as { __snowboard: Game }).__snowboard = created;
				// Top of the gondola if there is one, else the longest lift.
				const pick =
					created.lifts.find((l) => l.lift.kind === 'gondola') ??
					[...created.lifts].sort((a, b) => b.total - a.total)[0];
				liftId = pick?.lift.id ?? '';
				// Stand at the start, paused, so the menu sits over the view from the top.
				created.startAt(liftId);
			})
			.catch((e) => (message = e instanceof Error ? e.message : String(e)));
		return () => g?.dispose();
	});

	function start() {
		if (!game) return;
		game.startAt(liftId);
		started = true;
		menu = false;
		game.setPaused(false);
		canvas.focus();
	}
	function resume() {
		if (!game) return;
		menu = false;
		game.setPaused(false);
		canvas.focus();
	}
	function pause() {
		if (!game || !started) return;
		menu = true;
		game.setPaused(true);
	}
	$effect(() => game?.setShadows(shadows));

	// Keyboard.
	// Plain collections: read inside handlers only, never reactively.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const held = new Set<string>();
	function apply() {
		if (!game) return;
		const i = game.input;
		const left = held.has('ArrowLeft') || held.has('a') || held.has('A');
		const right = held.has('ArrowRight') || held.has('d') || held.has('D');
		i.steer = (right ? 1 : 0) - (left ? 1 : 0);
		i.tuck = held.has('ArrowUp') || held.has('w') || held.has('W') || held.has('Shift');
		i.brake = held.has('ArrowDown') || held.has('s') || held.has('S');
		i.jump = held.has(' ');
	}
	function onKeyDown(e: KeyboardEvent) {
		if (!game) return;
		if (e.key === 'Escape') {
			if (menu && started) resume();
			else pause();
			return;
		}
		if (menu) return;
		if (e.key === 'e' || e.key === 'E') game.board();
		if (e.key === 'r' || e.key === 'R') game.startAt(liftId);
		if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
			e.preventDefault();
		held.add(e.key);
		apply();
	}
	function onKeyUp(e: KeyboardEvent) {
		held.delete(e.key);
		apply();
	}
	function onBlur() {
		held.clear();
		apply();
	}

	// On-screen controls: each button holds an input while a finger is on it, and several can
	// be held at once since every pointer is captured by its own button.
	type Control = 'left' | 'right' | 'tuck' | 'brake' | 'jump';
	function hold(control: Control, on: boolean) {
		if (!game) return;
		const i = game.input;
		if (control === 'left') i.steer = on ? -1 : i.steer < 0 ? 0 : i.steer;
		else if (control === 'right') i.steer = on ? 1 : i.steer > 0 ? 0 : i.steer;
		else i[control] = on;
	}
	function press(control: Control) {
		return {
			onpointerdown: (e: PointerEvent) => {
				// Keep the pointer on the button even when the finger slides off it.
				try {
					(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				} catch {
					// Not an active pointer (synthetic events): the button still works.
				}
				hold(control, true);
			},
			onpointerup: () => hold(control, false),
			onpointercancel: () => hold(control, false)
		};
	}

	const credits: Credit[] = [
		CREDITS.gsiDem,
		{
			name: 'openstreetmap',
			by: '© openstreetmap contributors, odbl · skimap.org',
			use: 'ski runs, lifts and resort area',
			url: 'https://www.openstreetmap.org/copyright'
		}
	];
	const fmt = (n: number) => Math.round(n).toLocaleString();
</script>

<svelte:head><title>{data.tool.title} · Carto</title></svelte:head>
<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={onBlur} />

<div class="game" class:menu class:coarse>
	<canvas class="view" bind:this={canvas} tabindex="-1"></canvas>

	{#if hud && !menu}
		<div class="hud">
			<div class="run">
				{#if hud.onLift}
					<span class="name">{hud.onLift.lift.name}</span>
					<span class="sub">riding up · {fmt(hud.onLift.total)} m</span>
				{:else if hud.run}
					<span class="dot" style:background={hud.run.color}></span>
					<span class="name">{hud.run.name}</span>
					<span class="sub">{hud.run.difficulty}</span>
				{:else if hud.mode === 'crash'}
					<span class="name">wipeout</span>
				{:else}
					<span class="name faint">off piste</span>
				{/if}
			</div>
			<div class="stats">
				<span><b>{fmt(hud.speed)}</b> km/h</span>
				<span><b>{fmt(hud.altitude)}</b> m</span>
				{#if hud.mode === 'air'}<span class="air">air</span>{/if}
			</div>
		</div>
		{#if hud.nearLift}
			<button class="prompt" onclick={() => game?.board()}>
				<kbd>E</kbd> ride {hud.nearLift.lift.name}
			</button>
		{/if}
		<div class="foot">
			<span class="keys">
				<kbd>←</kbd><kbd>→</kbd> carve · <kbd>↑</kbd> tuck · <kbd>↓</kbd> brake · <kbd>space</kbd>
				jump ·
				<kbd>R</kbd> back to the top · <kbd>esc</kbd> menu
			</span>
			<span class="fps">{hud.fps} fps</span>
		</div>
		{#if coarse}
			<div class="touch">
				<div class="pad">
					<button class="key" aria-label="carve left" {...press('left')}>◀</button>
					<button class="key" aria-label="carve right" {...press('right')}>▶</button>
				</div>
				<div class="pad">
					<button class="key" aria-label="tuck" {...press('tuck')}>tuck</button>
					<button class="key" aria-label="brake" {...press('brake')}>brake</button>
					<button class="key" aria-label="jump" {...press('jump')}>jump</button>
				</div>
			</div>
			<button class="menu-button" aria-label="menu" onclick={pause}>≡</button>
		{/if}
	{/if}
	<div class="labels" bind:this={labelHost}></div>
	{#if game}
		<div class="minimap" class:hidden={menu}>
			<Minimap
				{game}
				features={data.features}
				woods={data.woods}
				onteleport={(lon, lat) => {
					game?.teleport(lon, lat);
					canvas.focus();
				}}
			/>
		</div>
	{/if}

	{#if menu}
		<div class="overlay">
			<div class="panel">
				<h1>{game?.resort.name ?? data.features.metadata?.name ?? data.tool.title}</h1>
				{#if game?.resort.nameJa}<p class="ja">{game.resort.nameJa}</p>{/if}
				<p class="blurb">
					Ride the real mountain: terrain from {provider.label} lidar tiles, streamed at 1 m round the
					board, with the runs, lifts and forest laid out from the resort's map data. The same tile sources
					feed the <a href={resolve('/diorama')}>Mountain Diorama</a> and
					<a href={resolve('/contour-maps')}>Contour Maps</a>.
				</p>
				{#if message}
					<p class="error">{message}</p>
				{:else if !game}
					<div class="loading">
						<span>{progress.stage}</span>
						{#if progress.fraction !== undefined}
							<span class="bar"><span style:width="{progress.fraction * 100}%"></span></span>
						{/if}
					</div>
				{:else}
					<div class="form">
						<Select
							label="start at the top of"
							options={lifts.map((l) => ({
								value: l.lift.id,
								label: `${l.lift.name} · ${Math.round(l.top.y)} m`
							}))}
							bind:value={liftId}
						/>
						<Toggle label="shadows" bind:checked={shadows} />
						<div class="actions">
							{#if started}
								<Button variant="primary" onclick={resume}>resume</Button>
								<Button onclick={start}>restart</Button>
							{:else}
								<Button variant="primary" onclick={start}>ride</Button>
							{/if}
						</div>
					</div>
					<ul class="legend">
						{#each Object.entries(DIFFICULTY_COLOR).filter(([k]) => k !== 'other') as [k, c] (k)}
							<li><span class="dot" style:background={c}></span>{k}</li>
						{/each}
						<li>
							<span class="count">{game.resort.runs.length}</span> runs ·
							<span class="count">{game.resort.lifts.length}</span> lifts
						</li>
					</ul>
					<p class="keys">
						{#if coarse}
							on-screen buttons to carve, tuck, brake and jump · tap the lift prompt to ride it ·
							tap the map to teleport
						{:else}
							<kbd>←</kbd><kbd>→</kbd> carve · <kbd>↑</kbd> tuck · <kbd>↓</kbd> brake ·
							<kbd>space</kbd> jump · <kbd>E</kbd> ride a lift · <kbd>R</kbd> back to the top
						{/if}
					</p>
				{/if}
				<ul class="credits">
					{#each credits as c (c.name)}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<li><a href={c.url} target="_blank" rel="noopener">{c.name}</a> · {c.by}</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}
</div>

<style>
	.game {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--color-base);
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	.view {
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
		touch-action: none;
	}
	.menu .view {
		filter: saturate(0.6) brightness(0.5);
	}

	/* HUD */
	.hud {
		position: absolute;
		top: 20px;
		left: var(--spacing-gutter);
		right: var(--spacing-gutter);
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		pointer-events: none;
		color: #fff;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
	}
	.run {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.run .name {
		font-size: var(--text-screen);
		font-weight: 600;
		letter-spacing: var(--tracking-title);
		text-transform: uppercase;
	}
	.run .faint {
		opacity: 0.6;
	}
	.run .sub {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		opacity: 0.8;
	}
	.dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
		align-self: center;
	}
	.stats {
		display: flex;
		gap: 20px;
		font-size: var(--text-content);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
	}
	.stats b {
		font-size: var(--text-screen);
		font-weight: 600;
		letter-spacing: 0;
	}
	.air {
		color: var(--color-accent);
	}
	.prompt {
		position: absolute;
		left: 50%;
		bottom: 96px;
		transform: translateX(-50%);
		font: inherit;
		font-size: var(--text-content);
		color: #fff;
		background: rgba(8, 8, 10, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.25);
		padding: 10px 16px;
		cursor: pointer;
		backdrop-filter: blur(6px);
	}
	.foot {
		position: absolute;
		left: var(--spacing-gutter);
		right: var(--spacing-gutter);
		bottom: 16px;
		display: flex;
		justify-content: space-between;
		font-size: var(--text-meta);
		color: rgba(255, 255, 255, 0.7);
		pointer-events: none;
	}
	kbd {
		font: inherit;
		font-size: var(--text-meta);
		padding: 1px 5px;
		border: 1px solid rgba(255, 255, 255, 0.3);
		margin: 0 1px;
	}
	.minimap {
		position: absolute;
		right: var(--spacing-gutter);
		bottom: 40px;
		width: 320px;
		height: 240px;
		max-width: 44vw;
		max-height: 36vh;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(8, 8, 10, 0.35);
		backdrop-filter: blur(4px);
	}
	.minimap.hidden {
		visibility: hidden;
	}
	.labels {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	.labels :global(.lift-label) {
		position: absolute;
		top: 0;
		left: 0;
		margin-bottom: 8px;
		padding: 3px 7px;
		font-size: var(--text-small);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		white-space: nowrap;
		color: #fff;
		background: rgba(8, 8, 10, 0.55);
		opacity: 0;
		will-change: transform, opacity;
	}

	/* Menu */
	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-gutter);
	}
	.panel {
		width: min(520px, 100%);
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	h1 {
		font-size: var(--text-screen);
		font-weight: 600;
		letter-spacing: var(--tracking-title);
		text-transform: uppercase;
		line-height: 1.3;
	}
	.ja {
		margin-top: -14px;
		font-size: var(--text-content);
		color: var(--color-text-tertiary);
	}
	.blurb {
		font-size: var(--text-content);
		color: var(--color-text-tertiary);
		max-width: 460px;
	}
	.blurb a {
		color: inherit;
		text-decoration: underline;
	}
	.loading {
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: var(--text-small);
		color: var(--color-text-faint);
	}
	.bar {
		display: block;
		height: 2px;
		background: var(--color-line);
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--color-accent);
		transition: width 0.2s;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 360px;
	}
	.actions {
		display: flex;
		gap: 12px;
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		font-size: var(--text-small);
		color: var(--color-text-secondary);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.legend .count {
		color: var(--color-text);
	}
	.panel .keys {
		font-size: var(--text-small);
		color: var(--color-text-faint);
	}
	.panel kbd {
		border-color: var(--color-line-control);
	}
	.credits {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		font-size: var(--text-meta);
		color: var(--color-text-dim);
	}
	.credits a {
		color: var(--color-text-faint);
	}
	.error {
		font-size: var(--text-small);
		color: var(--color-danger);
	}
	/* Touch controls */
	.touch {
		position: absolute;
		left: var(--spacing-gutter-mobile);
		right: var(--spacing-gutter-mobile);
		bottom: calc(16px + env(safe-area-inset-bottom));
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		pointer-events: none;
	}
	.pad {
		display: flex;
		gap: 10px;
		pointer-events: auto;
	}
	.key {
		min-width: 64px;
		height: 64px;
		padding: 0 14px;
		font: inherit;
		font-size: var(--text-small);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: #fff;
		background: rgba(8, 8, 10, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.3);
		backdrop-filter: blur(6px);
		touch-action: none;
	}
	.key:active {
		background: var(--color-accent-tint);
		border-color: var(--color-accent);
	}
	.menu-button {
		position: absolute;
		top: 12px;
		right: var(--spacing-gutter-mobile);
		width: 40px;
		height: 40px;
		font: inherit;
		font-size: var(--text-list);
		color: #fff;
		background: rgba(8, 8, 10, 0.45);
		border: 1px solid rgba(255, 255, 255, 0.3);
	}
	.coarse .foot .keys {
		display: none;
	}
	.coarse .prompt {
		bottom: 110px;
	}
	.coarse .minimap {
		right: var(--spacing-gutter-mobile);
		bottom: calc(96px + env(safe-area-inset-bottom));
		width: 170px;
		height: 130px;
	}
	.coarse .stats {
		margin-right: 52px;
	}
	@media (max-width: 640px) {
		.hud {
			left: var(--spacing-gutter-mobile);
			right: var(--spacing-gutter-mobile);
			top: 14px;
		}
		.run .name,
		.stats b {
			font-size: var(--text-list);
		}
		.run .sub {
			display: none;
		}
		.stats {
			gap: 12px;
		}
		.foot .keys {
			display: none;
		}
		.minimap {
			right: var(--spacing-gutter-mobile);
			width: 150px;
			height: 120px;
		}
		.touch .key {
			min-width: 54px;
			height: 54px;
			padding: 0 10px;
		}
		.overlay {
			align-items: flex-start;
			overflow-y: auto;
			padding: 32px var(--spacing-gutter-mobile);
		}
	}
</style>
