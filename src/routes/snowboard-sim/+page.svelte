<!--
	Snowboard down a real resort: GSI 1 m lidar terrain streamed round the rider, the runs,
	lifts and forest laid out from the resort's GeoJSON. Keyboard to ride, lifts to get back up.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import chairlift1 from '@liquidx/diorama/models/chairlift-1.glb?url';
	import chairlift2 from '@liquidx/diorama/models/chairlift-2.glb?url';
	import chairlift3 from '@liquidx/diorama/models/chairlift-3.glb?url';
	import chairlift4 from '@liquidx/diorama/models/chairlift-4.glb?url';
	import gondola from '@liquidx/diorama/models/gondola.glb?url';
	import liftStation from '@liquidx/diorama/models/lift-station.glb?url';
	import ropeway from '@liquidx/diorama/models/ropeway.glb?url';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '$lib/components/Button.svelte';
	import Combobox from '$lib/components/Combobox.svelte';
	import { locationOptions } from '$lib/diorama/locations';
	import Select from '$lib/components/Select.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { PROVIDERS } from '$lib/contour/terrain-api';
	import { CREDITS, type Credit } from '$lib/credits';
	import { createGame, type Game, type Hud, type LoadProgress } from '$lib/snowboard/game';
	import Minimap from '$lib/snowboard/Minimap.svelte';
	import { DIFFICULTY_COLOR } from '$lib/snowboard/resort';

	let { data } = $props();

	let canvas = $state<HTMLCanvasElement>();
	let labelHost: HTMLElement;
	let game = $state.raw<Game | null>(null);
	let progress = $state<LoadProgress>({ stage: 'loading' });
	let message = $state('');
	let hud = $state.raw<Hud | null>(null);
	/** The start screen shows before the first run and whenever the game is paused. */
	let menu = $state(true);
	let started = $state(false);
	let liftId = $state('');
	/** The map opened up to fill the view; the ride waits while it is. */
	let mapOpen = $state(false);
	let showFps = $state(false);
	/** The touch controls, as listed on the menu: what it does, and the gesture for it. */
	const gestures = [
		['carve', 'drag left or right'],
		['tuck', 'hold without dragging'],
		['jump', 'flick up'],
		['spin', 'keep dragging in the air'],
		['brake', 'drag down, or a second finger'],
		['lift', 'tap one to ride it'],
		['teleport', 'tap the map']
	];
	let locationId = $state('');
	/** The picked resort's data is on its way. */
	let loading = $state(false);
	/** A touch screen: on-screen controls and lighter rendering. `?touch` forces it, for testing. */
	const coarse =
		typeof window !== 'undefined' &&
		(matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch'));
	let shadows = $state(!coarse);

	const lifts = $derived(game?.lifts ?? []);
	/** Good places to start, a tap away on the first screen. */
	const FEATURED = ['nozawa-onsen', 'niseko-united', 'appi-kogen'];
	const featured = $derived(
		FEATURED.flatMap((id) => data.locations.find((l) => l.id === id) ?? [])
	);
	/** Every resort there is data for. */
	const resorts = $derived(locationOptions(data.locations));
	const provider = PROVIDERS.find((p) => p.id === 'gsi-1m')!;

	// A game for each resort, on a canvas of its own: the last one's WebGL context is given up.
	$effect(() => {
		const { features, woods } = data;
		const el = canvas;
		untrack(() => {
			game = null;
			hud = null;
			progress = { stage: 'loading' };
			message = '';
			menu = true;
			started = false;
			locationId = data.locationId;
		});
		// Nothing to build until a resort is picked.
		if (!features || !el?.isConnected) return;
		let g: Game | undefined;
		let gone = false;
		createGame(
			el,
			features,
			{
				provider: provider.id,
				shadows: untrack(() => shadows),
				labels: labelHost,
				woods,
				chairModels: {
					1: chairlift1,
					2: chairlift2,
					3: chairlift3,
					4: chairlift4
				},
				cabinModel: gondola,
				ropewayModel: ropeway,
				stationModel: liftStation,
				treeSpacing: coarse ? 18 : 14,
				maxPixelRatio: coarse ? 1.5 : 2
			},
			(p) => gone || (progress = p),
			(h) => gone || (hud = h)
		)
			.then((created) => {
				// Another resort was picked while this one was loading.
				if (gone) return created.dispose();
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
			.catch((e) => gone || (message = e instanceof Error ? e.message : String(e)));
		return () => {
			gone = true;
			g?.dispose();
		};
	});

	/** Ride somewhere else: the page loads that resort's data and the game is built again. */
	function pickLocation(id: string) {
		if (!id) return;
		const url = new URL(page.url);
		url.searchParams.set('locationId', id);
		loading = true;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, query only
		goto(url, { keepFocus: true }).finally(() => (loading = false));
	}

	function start() {
		if (!game) return;
		game.startAt(liftId);
		started = true;
		menu = false;
		game.setPaused(false);
		canvas?.focus();
	}
	function resume() {
		if (!game) return;
		menu = false;
		game.setPaused(false);
		canvas?.focus();
	}
	function pause() {
		if (!game || !started) return;
		mapOpen = false;
		menu = true;
		game.setPaused(true);
	}
	$effect(() => {
		if (!menu) game?.setPaused(mapOpen);
	});
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
			if (mapOpen) mapOpen = false;
			else if (menu && started) resume();
			else pause();
			return;
		}
		if (menu) return;
		if (e.key === 'm' || e.key === 'M') mapOpen = !mapOpen;
		if (e.key === 'f' || e.key === 'F') showFps = !showFps;
		if (mapOpen) return;
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

	// Touch: gestures on the view instead of on-screen buttons. The first finger steers by how
	// far it has dragged sideways from where it landed, brakes while it is dragged down, tucks
	// while it is held about where it landed, and jumps on a quick flick up. A second finger on
	// the screen brakes too, and a tap on a lift rides it.
	/** Sideways drag for a full carve, and the drag down that brakes, in pixels. */
	const CARVE_PX = 60;
	const BRAKE_PX = 45;
	/** A held finger tucks until it has dragged this far to a side, in pixels. */
	const TUCK_PX = 20;
	/** A flick: moving up faster than this, in pixels a millisecond, over at least `FLICK_PX`. */
	const FLICK_SPEED = 0.9;
	const FLICK_PX = 30;
	/** A tap: up again within this long, in milliseconds, having moved no further than `TAP_PX`. */
	const TAP_MS = 300;
	const TAP_PX = 10;
	type Touch = {
		id: number;
		x0: number;
		y0: number;
		t0: number;
		dx: number;
		dy: number;
		/** Down for longer than a tap. */
		held: boolean;
		y: number;
		t: number;
		low: number;
	};
	let primary: Touch | null = null;
	/** Where the mouse went down; a press that does not drag is a click on a lift. */
	let click: [x: number, y: number] | null = null;
	let fingers = 0;
	let jumpTimer: ReturnType<typeof setTimeout> | undefined;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	/** Steering, braking and tucking from where the fingers are now. */
	function applyTouch() {
		if (!game) return;
		const i = game.input;
		i.steer = primary ? Math.max(-1, Math.min(1, primary.dx / CARVE_PX)) : 0;
		i.brake = fingers > 1 || (!!primary && primary.dy > BRAKE_PX);
		i.tuck = !!primary?.held && !i.brake && Math.abs(primary.dx) < TUCK_PX;
	}
	function pulseJump() {
		if (!game) return;
		game.input.jump = true;
		clearTimeout(jumpTimer);
		jumpTimer = setTimeout(() => game && (game.input.jump = false), 150);
	}
	function onTouchDown(e: PointerEvent) {
		if (e.pointerType === 'mouse') click = [e.clientX, e.clientY];
		if (e.pointerType === 'mouse' || !game) return;
		fingers++;
		if (fingers > 1) return applyTouch();
		const touch: Touch = {
			id: e.pointerId,
			x0: e.clientX,
			y0: e.clientY,
			t0: e.timeStamp,
			dx: 0,
			dy: 0,
			held: false,
			y: e.clientY,
			t: e.timeStamp,
			low: e.clientY
		};
		primary = touch;
		// Not a tuck until it has outlasted a tap, so that tapping a lift is only that.
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => {
			touch.held = true;
			if (primary === touch) applyTouch();
		}, TAP_MS);
	}
	function onTouchMove(e: PointerEvent) {
		if (!primary || e.pointerId !== primary.id || !game) return;
		primary.dx = e.clientX - primary.x0;
		primary.dy = e.clientY - primary.y0;
		applyTouch();
		// A flick up: fast, and risen enough from the lowest point the finger reached.
		const dt = e.timeStamp - primary.t;
		const rise = primary.low - e.clientY;
		if (dt > 0 && (primary.y - e.clientY) / dt > FLICK_SPEED && rise > FLICK_PX) {
			pulseJump();
			primary.low = e.clientY;
		}
		primary.low = Math.max(primary.low, e.clientY);
		primary.y = e.clientY;
		primary.t = e.timeStamp;
	}
	function onTouchUp(e: PointerEvent) {
		if (e.pointerType === 'mouse') {
			// Dragging looks around; a click on a lift gets on it.
			const still = click && Math.hypot(e.clientX - click[0], e.clientY - click[1]) < TAP_PX;
			click = null;
			if (still && e.type === 'pointerup') game?.boardAt(e.clientX, e.clientY);
			return;
		}
		if (!game) return;
		fingers = Math.max(0, fingers - 1);
		if (primary && e.pointerId === primary.id) {
			// A tap on a lift gets on it.
			if (
				e.type === 'pointerup' &&
				e.timeStamp - primary.t0 < TAP_MS &&
				Math.hypot(e.clientX - primary.x0, e.clientY - primary.y0) < TAP_PX
			)
				game.boardAt(e.clientX, e.clientY);
			// The steering finger is up: let go of everything, whatever else is still down.
			primary = null;
			fingers = 0;
			clearTimeout(holdTimer);
		}
		applyTouch();
	}

	const credits: Credit[] = [
		CREDITS.snowline,
		CREDITS.openSkiData,
		CREDITS.overture,
		CREDITS.gsiDem
	];
	const fmt = (n: number) => Math.round(n).toLocaleString();
	/** Seconds as minutes and seconds, 1:05. */
	const clock = (s: number) =>
		`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<svelte:head><title>{data.tool.title} · Carto</title></svelte:head>
<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={onBlur} />

<div class="game" class:menu class:coarse>
	{#key data.features}
		<canvas
			class="view"
			bind:this={canvas}
			tabindex="-1"
			onpointerdown={onTouchDown}
			onpointermove={onTouchMove}
			onpointerup={onTouchUp}
			onpointercancel={onTouchUp}
		></canvas>
	{/key}

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
			<div class="side">
				<div class="stats">
					<span><b>{fmt(hud.speed)}</b> km/h</span>
					<span><b>{clock(hud.elapsed)}</b></span>
					{#if hud.mode === 'air'}<span class="air">air</span>{/if}
				</div>
				{#if showFps}<span class="fps">{hud.fps} fps</span>{/if}
			</div>
		</div>
		{#if hud.nearLift}
			<button class="prompt" onclick={() => game?.board()}>
				<kbd>E</kbd> ride {hud.nearLift.lift.name}
			</button>
		{/if}
		<div class="foot">
			{#if coarse}
				<span>swipe up to jump</span>
				<span>swipe down to brake</span>
				<span>hold still to tuck</span>
			{:else}
				<span class="keys">
					<kbd>←</kbd><kbd>→</kbd> carve · <kbd>↑</kbd> tuck · <kbd>↓</kbd> brake · <kbd>space</kbd>
					jump, <kbd>←</kbd><kbd>→</kbd> in the air to spin ·
					<kbd>R</kbd> back to the top · <kbd>M</kbd> map · <kbd>esc</kbd> menu
				</span>
			{/if}
		</div>
		{#if coarse}
			<button class="menu-button" aria-label="menu" onclick={pause}>≡</button>
		{/if}
	{/if}
	<div class="labels" bind:this={labelHost}></div>
	{#if game && data.features}
		<div class="minimap" class:hidden={menu} class:expanded={mapOpen}>
			<Minimap
				{game}
				woods={data.woods}
				water={data.water}
				bind:expanded={mapOpen}
				onteleport={(lon, lat) => {
					game?.teleport(lon, lat);
					// Picked a place off the big map: back to the ride.
					mapOpen = false;
					canvas?.focus();
				}}
			/>
		</div>
	{/if}

	{#if menu}
		<div class="overlay">
			<div class="panel">
				<h1>{game?.resort.name ?? data.features?.metadata?.name ?? data.tool.title}</h1>
				{#if game?.resort.nameJa}<p class="ja">{game.resort.nameJa}</p>{/if}
				<p class="blurb">
					A simulation of riding down the actual terrain of the mountain, from GSI Japan elevation
					data at 1 m and 5 m resolution and wooded areas from OpenStreetMap.
				</p>
				<div class="form">
					{#if !data.locationId}
						<div class="featured">
							{#each featured as f (f.id)}
								<Button
									variant={locationId === f.id ? 'primary' : 'neutral'}
									onclick={() => {
										locationId = f.id;
										pickLocation(f.id);
									}}
								>
									{f.nameEn}
								</Button>
							{/each}
						</div>
					{/if}
					<Combobox
						label={data.locationId ? 'resort' : undefined}
						placeholder="other resorts"
						searchPlaceholder="search resorts"
						options={resorts}
						bind:value={locationId}
						onchange={pickLocation}
					/>
				</div>
				{#if message}
					<p class="error">{message}</p>
				{:else if !data.features && !loading}
					<!-- Waiting for a resort to be picked. -->
				{:else if !game || loading}
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
					{#if coarse}
						<dl class="gestures">
							{#each gestures as [what, how] (what)}
								<dt>{what}</dt>
								<dd>{how}</dd>
							{/each}
						</dl>
					{:else}
						<p class="keys">
							<kbd>←</kbd><kbd>→</kbd> carve · <kbd>↑</kbd> tuck · <kbd>↓</kbd> brake ·
							<kbd>space</kbd> jump, and <kbd>←</kbd><kbd>→</kbd> in the air to spin round and land
							switch · <kbd>E</kbd> or click a lift to ride it · <kbd>R</kbd> back to the top ·
							<kbd>M</kbd> map · <kbd>F</kbd> fps
						</p>
					{/if}
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
	.side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}
	.fps {
		font-size: var(--text-meta);
	}
	.stats {
		display: flex;
		gap: 20px;
		font-size: var(--text-content);
		text-transform: uppercase;
		letter-spacing: var(--tracking-label);
	}
	.stats b {
		font-variant-numeric: tabular-nums;
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
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		font-size: var(--text-meta);
		color: #fff;
		pointer-events: none;
	}
	/* On a dark plate like the lift prompt, so the tips read over the snow. */
	.foot span {
		padding: 6px 10px;
		line-height: 1.7;
		background: rgba(8, 8, 10, 0.6);
		backdrop-filter: blur(6px);
	}
	kbd {
		font: inherit;
		font-size: var(--text-meta);
		padding: 1px 5px;
		border: 1px solid rgba(255, 255, 255, 0.45);
		margin: 0 1px;
	}
	.minimap {
		position: absolute;
		right: var(--spacing-gutter);
		/* Clear of the keys along the bottom, on two lines in a narrow window. */
		bottom: 80px;
		width: 320px;
		height: 240px;
		max-width: 44vw;
		max-height: 36vh;
		/* Only the map itself takes the pointer; the room round it lets the view through. */
		pointer-events: none;
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
		padding: 1px 5px;
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		white-space: nowrap;
		color: rgba(255, 255, 255, 0.85);
		background: rgba(8, 8, 10, 0.22);
		opacity: 0;
		transform-origin: 50% 100%;
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
	.featured {
		display: flex;
		flex-direction: column;
		gap: 8px;
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
	.gestures {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 20px;
		margin: 0;
		font-size: var(--text-small);
		color: var(--color-text-faint);
	}
	.gestures dt {
		color: var(--color-text);
	}
	.gestures dd {
		margin: 0;
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
	.coarse .prompt {
		bottom: 110px;
	}
	.coarse .minimap {
		right: var(--spacing-gutter-mobile);
		bottom: calc(96px + env(safe-area-inset-bottom));
		width: 170px;
		height: 130px;
	}
	.coarse .side {
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
		.overlay {
			align-items: flex-start;
			overflow-y: auto;
			padding: 32px var(--spacing-gutter-mobile);
		}
	}
	/* The map opened up: over the view, clear of the HUD. */
	.game .minimap.expanded {
		top: 72px;
		left: var(--spacing-gutter);
		right: var(--spacing-gutter);
		bottom: 80px;
		width: auto;
		height: auto;
		max-width: none;
		max-height: none;
	}
	.game.coarse .minimap.expanded {
		top: 64px;
		left: var(--spacing-gutter-mobile);
		right: var(--spacing-gutter-mobile);
		bottom: calc(24px + env(safe-area-inset-bottom));
	}
</style>
