<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import PromptField from '$lib/components/PromptField.svelte';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Select from '$lib/components/Select.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import StatusToken from '$lib/components/StatusToken.svelte';
	import TickStrip from '$lib/components/TickStrip.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const principles = [
		[
			'01 / sharp',
			'No rounded corners. Structure is drawn with 1px hairlines, ticks and boxed cells.'
		],
		[
			'02 / airy',
			'Lots of black space. Few elements per view. Density comes from data, not chrome.'
		],
		[
			'03 / sparing accent',
			'The accent marks one thing per view: the live point or the primary action.'
		],
		[
			'04 / labels vs values',
			'UPPERCASE tracked labels; lowercase values. The mono grid does the rest.'
		],
		[
			'05 / no dots',
			'Never put a colored dot next to text: no status dots, bullets or glowing marks. State is carried by the text color itself.'
		]
	];

	const swatches = [
		['base', '--color-base', 'app background'],
		['surface', '--color-surface', 'panels, inputs'],
		['map-ink', '--color-map-ink', 'map canvas'],
		['accent', '--color-accent', 'live · primary'],
		['accent-muted', '--color-accent-muted', 'secondary markers'],
		['bar-track', '--color-bar-track', 'non-peak fill'],
		['text', '--color-text', 'titles, values'],
		['text/secondary', '--color-text-secondary', 'body'],
		['text/tertiary', '--color-text-tertiary', 'secondary meta'],
		['text/faint', '--color-text-faint', 'dates, labels'],
		['warn', '--color-warn', 'pending, caution'],
		['danger', '--color-danger', 'destructive']
	];

	let hillshade = $state(true);
	let labels = $state(false);
	let mode = $state<'lines' | 'filled' | 'both'>('lines');
	let interval = $state(20);
	let smoothing = $state(0.4);
	let format = $state<'png' | 'webp' | 'tiff'>('png');
	let query = $state('');
	const activeChips = new SvelteSet(['srtm']);
	const chips = ['srtm', 'copernicus', 'lidar', 'osm'];

	function toggleChip(c: string) {
		if (activeChips.has(c)) activeChips.delete(c);
		else activeChips.add(c);
	}
</script>

<svelte:head><title>System · Carto</title></svelte:head>

<section class="hero">
	<h1>SYSTEM</h1>
	<div class="meta">
		<span>wanderloop v2.0 · terminal / hud</span>
		<span>type · spline sans mono</span>
		<span>accent · oklch(.73 .13 230)</span>
	</div>
	<TickStrip />
</section>

<section>
	<SectionLabel index="§00" label="Principles" />
	<div class="principles">
		{#each principles as [title, body] (title)}
			<div class="principle">
				<div class="principle-title">{title}</div>
				<p>{body}</p>
			</div>
		{/each}
	</div>
</section>

<section>
	<SectionLabel index="§01" label="Color" descriptor="tokens" />
	<div class="swatches">
		{#each swatches as [name, token, use] (token)}
			<div class="swatch">
				<div class="chip-color" style:background="var({token})"></div>
				<div class="swatch-text">
					<div>{name}</div>
					<div class="faint">{token}</div>
					<div class="faint micro">{use}</div>
				</div>
			</div>
		{/each}
	</div>
</section>

<section>
	<SectionLabel index="§02" label="Typography" descriptor="spline sans mono" />
	<div class="type-rows">
		<div class="type-row">
			<span class="t-display">CONTOURS</span><span class="spec">screen · 23px / 600 / +.05em</span>
		</div>
		<div class="type-row">
			<span class="t-list">mount fuji · 3776 m</span><span class="spec">list · 16px / 400</span>
		</div>
		<div class="type-row">
			<span class="t-secondary">富士山</span><span class="spec">secondary · 12px</span>
		</div>
		<div class="type-row">
			<span class="t-label">SECTION LABEL</span><span class="spec"
				>label · 10px / +.16em / UPPER</span
			>
		</div>
		<div class="type-row">
			<span class="t-micro">MAP · LAYERS · EXPORT</span><span class="spec">micro · 9px / +.1em</span
			>
		</div>
	</div>
</section>

<section>
	<SectionLabel index="§03" label="Controls" descriptor="live samples" />
	<div class="grid">
		<div class="card">
			<div class="card-label">BUTTONS</div>
			<div class="row">
				<Button variant="primary">export</Button>
				<Button>reset</Button>
				<Button variant="danger">delete</Button>
				<Button size="sm">small</Button>
				<Button disabled>disabled</Button>
			</div>
		</div>

		<div class="card">
			<div class="card-label">STATUS TOKENS</div>
			<div class="row">
				<StatusToken state="ok">rendered</StatusToken>
				<StatusToken state="pending">tracing…</StatusToken>
				<StatusToken state="off">idle</StatusToken>
			</div>
		</div>

		<div class="card">
			<div class="card-label">TOGGLE</div>
			<div class="stack">
				<Toggle label="hillshade" bind:checked={hillshade} />
				<Toggle label="elevation labels" bind:checked={labels} />
			</div>
		</div>

		<div class="card">
			<div class="card-label">SEGMENTED</div>
			<Segmented
				label="contour style"
				options={[{ value: 'lines' }, { value: 'filled' }, { value: 'both' }]}
				bind:value={mode}
			/>
		</div>

		<div class="card">
			<div class="card-label">SLIDER</div>
			<div class="stack">
				<Slider label="interval" unit=" m" min={5} max={200} step={5} bind:value={interval} />
				<Slider
					label="smoothing"
					min={0}
					max={1}
					step={0.05}
					format={(v) => v.toFixed(2)}
					bind:value={smoothing}
				/>
			</div>
		</div>

		<div class="card">
			<div class="card-label">SELECT</div>
			<Select
				label="output format"
				options={[{ value: 'png' }, { value: 'webp' }, { value: 'tiff', label: 'geotiff' }]}
				bind:value={format}
			/>
		</div>

		<div class="card">
			<div class="card-label">CHIPS</div>
			<div class="row">
				{#each chips as c (c)}
					<Chip active={activeChips.has(c)} onclick={() => toggleChip(c)}>{c}</Chip>
				{/each}
			</div>
		</div>

		<div class="card">
			<div class="card-label">PROMPT FIELD</div>
			<PromptField placeholder="search places" hint="⏎ find" bind:value={query} />
		</div>
	</div>
</section>

<style>
	section {
		margin-top: 64px;
	}
	.hero {
		padding-top: 96px;
		margin-top: 0;
	}
	h1 {
		font-size: var(--text-display);
		font-weight: 600;
		letter-spacing: 0.02em;
		line-height: 1;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 26px;
		margin: 20px 0 22px;
		font-size: var(--text-small);
		letter-spacing: 0.04em;
		color: var(--color-text-label);
	}
	.principles {
		margin-top: 24px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
		gap: 1px;
		background: var(--color-line);
		border: 1px solid var(--color-line);
	}
	.principle {
		background: var(--color-base);
		padding: 18px;
	}
	.principle-title {
		font-size: var(--text-small);
		letter-spacing: var(--tracking-micro);
		color: var(--color-accent);
	}
	.principle p {
		margin-top: 9px;
		font-size: var(--text-small);
		line-height: 1.7;
		color: #8a8a94;
	}
	.swatches {
		margin-top: 24px;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
		gap: 14px;
	}
	.swatch {
		border: 1px solid var(--color-line);
	}
	.chip-color {
		height: 54px;
		border-bottom: 1px solid var(--color-line);
	}
	.swatch-text {
		padding: 9px 11px;
		font-size: var(--text-small);
	}
	.faint {
		color: var(--color-text-faint);
		font-size: var(--text-meta);
		margin-top: 2px;
	}
	.micro {
		font-size: var(--text-micro);
		margin-top: 5px;
	}
	.type-rows {
		margin-top: 24px;
		border: 1px solid var(--color-line);
	}
	.type-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 16px;
		flex-wrap: wrap;
		padding: 16px 18px;
		border-bottom: 1px solid var(--color-line-faint);
	}
	.type-row:last-child {
		border-bottom: 0;
	}
	.t-display {
		font-size: var(--text-screen);
		font-weight: 600;
		letter-spacing: var(--tracking-title);
	}
	.t-list {
		font-size: var(--text-list);
	}
	.t-secondary {
		color: var(--color-text-secondary);
	}
	.t-label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		color: var(--color-text-label);
	}
	.t-micro {
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-micro);
		color: #8a8a94;
	}
	.spec {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.grid {
		margin-top: 24px;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr));
		gap: 18px;
	}
	.card {
		border: 1px solid var(--color-line);
		padding: 16px 16px 20px;
	}
	.card-label {
		font-size: var(--text-meta);
		letter-spacing: 0.14em;
		color: var(--color-text-label);
		margin-bottom: 16px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 9px 18px;
		align-items: center;
	}
	.card .row:has(:global(.btn)) {
		gap: 9px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	@media (max-width: 719px) {
		.hero {
			padding-top: 48px;
		}
		h1 {
			font-size: 30px;
		}
	}
</style>
