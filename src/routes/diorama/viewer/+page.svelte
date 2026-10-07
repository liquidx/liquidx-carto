<!--
	Views a GLB exported from the Mountain Diorama tool with the packaged renderer
	(`@liquidx/diorama`), the same way another project would.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Diorama,
		Drape,
		type DioramaMeta,
		type GeoJSONInput,
		type TerrainPreset
	} from '@liquidx/diorama';
	import DropZone from '$lib/components/DropZone.svelte';
	import Segmented from '$lib/components/Segmented.svelte';

	// One colour per dropped GeoJSON file, readable on both the topo and the snow terrain.
	const OVERLAY_COLORS = ['#d1345b', '#1c7ed6', '#2b8a3e', '#e8590c', '#7048e8'];

	let file = $state.raw<File | null>(null);
	let meta = $state.raw<DioramaMeta | null>(null);
	let terrain = $state<TerrainPreset>('topo');
	let overlays = $state.raw<{ name: string; data: GeoJSONInput }[]>([]);
	let message = $state('');

	const isGlb = (name: string) => /\.glb$/i.test(name);
	const isGeoJson = (name: string) => /\.(geojson|json)$/i.test(name);

	async function open(files: File[]) {
		message = '';
		const glb = files.find((f) => isGlb(f.name));
		if (glb) {
			file = glb;
			meta = null;
		}
		try {
			const added = await Promise.all(
				files
					.filter((f) => isGeoJson(f.name))
					.map(async (f) => ({ name: f.name, data: JSON.parse(await f.text()) as GeoJSONInput }))
			);
			overlays = [...overlays, ...added];
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<svelte:head><title>Diorama Viewer · Carto</title></svelte:head>

<section class="head">
	<h1>Diorama Viewer</h1>
	<p>
		Open a GLB exported from the <a href={resolve('/diorama')}>Mountain Diorama</a> tool, rendered
		with the reusable
		<code>@liquidx/diorama</code> component. Drop GeoJSON files to draw them on the terrain.
	</p>
</section>

<section class="body">
	<DropZone
		title="drop a diorama glb, or geojson to draw on it"
		extensions=".glb,.geojson,.json"
		accept={(name) => isGlb(name) || isGeoJson(name)}
		onfiles={open}
	/>
	{#if file}
		<div class="stage">
			<Diorama
				src={file}
				{terrain}
				onload={(m) => (meta = m)}
				onerror={(e) => (message = e instanceof Error ? e.message : String(e))}
			>
				{#each overlays as overlay, i (overlay)}
					{@const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length]}
					<Drape data={overlay.data} paint={{ stroke: color, fill: color + '40', width: 2 }} />
				{/each}
			</Diorama>
		</div>
		<div class="row">
			<div class="style">
				<Segmented
					label="terrain style"
					options={[{ value: 'topo' }, { value: 'snow' }]}
					bind:value={terrain}
				/>
			</div>
			{#if meta}
				<div class="readout">
					{Math.round(meta.minZ)}–{Math.round(meta.maxZ)} m · ⌀ {(meta.radius / 500).toFixed(1)} km ·
					{meta.exaggeration}× relief
				</div>
			{/if}
		</div>
		{#if overlays.length}
			<div class="overlays">
				{#each overlays as overlay, i (overlay)}
					<span class="overlay">
						<span class="swatch" style:background={OVERLAY_COLORS[i % OVERLAY_COLORS.length]}
						></span>
						{overlay.name}
					</span>
				{/each}
				<button type="button" class="clear" onclick={() => (overlays = [])}>clear</button>
			</div>
		{/if}
	{/if}
	{#if message}<div class="error">{message}</div>{/if}
</section>

<style>
	.head {
		padding: 96px 0 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 18px;
	}
	h1 {
		font-size: var(--text-screen);
		font-weight: 600;
		letter-spacing: var(--tracking-title);
		text-transform: uppercase;
		line-height: 1.4;
	}
	.head p {
		max-width: 560px;
		font-size: var(--text-content);
		color: var(--color-text-tertiary);
	}
	.head p a {
		color: inherit;
		text-decoration: underline;
	}
	.body {
		margin-top: 64px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.stage {
		height: 560px;
		--diorama-background: var(--color-surface);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 20px;
	}
	.style {
		width: 200px;
	}
	.readout {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.overlays {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 20px;
		font-size: var(--text-meta);
		color: var(--color-text-tertiary);
	}
	.overlay {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.swatch {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.clear {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
		text-decoration: underline;
	}
	.error {
		font-size: var(--text-small);
		color: var(--color-danger);
	}
	@media (max-width: 640px) {
		.stage {
			height: 420px;
		}
	}
</style>
