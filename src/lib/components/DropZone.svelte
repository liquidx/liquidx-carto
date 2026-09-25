<!--
	File drop target: dashed hairline box on surface. Accepts files, multiple selection and
	whole folders (walked recursively). `accept` filters by file name.
-->
<script lang="ts">
	type Props = {
		onfiles: (files: File[]) => void;
		accept?: (name: string) => boolean;
		/** Extensions for the native file picker, e.g. ".xml,.zip". */
		extensions?: string;
		title?: string;
		hint?: string;
	};

	let {
		onfiles,
		accept = () => true,
		extensions,
		title = 'drop files here',
		hint
	}: Props = $props();

	let over = $state(false);
	let input: HTMLInputElement;

	async function collect(items: DataTransferItemList): Promise<File[]> {
		const files: File[] = [];
		const entries: FileSystemEntry[] = [];
		for (const item of items) {
			const e = item.webkitGetAsEntry?.();
			if (e) entries.push(e);
			else {
				const f = item.getAsFile();
				if (f && accept(f.name)) files.push(f);
			}
		}
		const readEntry = (entry: FileSystemEntry): Promise<void> =>
			new Promise((resolve) => {
				if (entry.isFile) {
					(entry as FileSystemFileEntry).file(
						(f) => {
							if (accept(f.name)) files.push(f);
							resolve();
						},
						() => resolve()
					);
				} else if (entry.isDirectory) {
					const reader = (entry as FileSystemDirectoryEntry).createReader();
					const readAll = () =>
						reader.readEntries(
							async (batch) => {
								if (!batch.length) return resolve();
								await Promise.all(batch.map(readEntry));
								readAll();
							},
							() => resolve()
						);
					readAll();
				} else resolve();
			});
		await Promise.all(entries.map(readEntry));
		return files;
	}

	async function ondrop(e: DragEvent) {
		e.preventDefault();
		over = false;
		if (!e.dataTransfer) return;
		const files = e.dataTransfer.items?.length
			? await collect(e.dataTransfer.items)
			: [...e.dataTransfer.files].filter((f) => accept(f.name));
		if (files.length) onfiles(files);
	}
</script>

<div
	class="drop"
	class:over
	role="button"
	tabindex="0"
	ondragover={(e) => {
		e.preventDefault();
		over = true;
	}}
	ondragleave={() => (over = false)}
	{ondrop}
	onclick={() => input.click()}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input.click()}
>
	<span class="title">{title}</span>
	{#if hint}<span class="hint">{hint}</span>{/if}
	<input
		bind:this={input}
		type="file"
		multiple
		accept={extensions}
		hidden
		onchange={(e) => {
			const files = [...(e.currentTarget.files ?? [])].filter((f) => accept(f.name));
			if (files.length) onfiles(files);
			e.currentTarget.value = '';
		}}
	/>
</div>

<style>
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 32px 16px;
		background: var(--color-surface);
		border: 1px dashed var(--color-line-control);
		cursor: pointer;
		text-align: center;
	}
	.title {
		font-size: var(--text-small);
		text-transform: lowercase;
		color: var(--color-text-ui);
	}
	.hint {
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.over {
		border-color: var(--color-accent);
		background: var(--color-accent-tint-faint);
	}
	@media (hover: hover) {
		.drop:hover {
			border-color: var(--color-accent-muted);
		}
	}
</style>
