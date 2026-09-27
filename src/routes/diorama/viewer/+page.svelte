<!--
	Views a GLB exported from the Mountain Diorama tool with the packaged renderer
	(`@liquidx/diorama`), the same way another project would.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { DioramaViewer, type DioramaMeta } from '@liquidx/diorama';
	import DropZone from '$lib/components/DropZone.svelte';

	let file = $state.raw<File | null>(null);
	let meta = $state.raw<DioramaMeta | null>(null);
	let message = $state('');
</script>

<svelte:head><title>Diorama Viewer · Carto</title></svelte:head>

<section class="head">
	<h1>Diorama Viewer</h1>
	<p>
		Open a GLB exported from the <a href={resolve('/diorama')}>Mountain Diorama</a> tool, rendered
		with the reusable
		<code>@liquidx/diorama</code> viewer.
	</p>
</section>

<section class="body">
	<DropZone
		title="drop a diorama glb"
		extensions=".glb"
		accept={(name) => name.toLowerCase().endsWith('.glb')}
		onfiles={(files) => {
			message = '';
			file = files[0] ?? null;
		}}
	/>
	{#if file}
		<div class="stage">
			<DioramaViewer
				src={file}
				onload={(m) => (meta = m)}
				onerror={(e) => (message = e instanceof Error ? e.message : String(e))}
			/>
		</div>
		{#if meta}
			<div class="readout">
				{Math.round(meta.minZ)}–{Math.round(meta.maxZ)} m · ⌀ {(meta.radius / 500).toFixed(1)} km ·
				{meta.exaggeration}× relief
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
	.readout {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
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
