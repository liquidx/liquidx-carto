<!--
	Label what's where around a ski resort, woods and open ground to start (the classes are
	defined here, kept in the browser and written into the labels exported), and train a classifier of Tessera's embeddings on them, here or with
	`pnpm tessera-classifier` (the same code). The resort's scene square, its OpenStreetMap woods
	and its runs are read as the Snow Diorama reads them; the labels are kept in the browser per
	resort and exported as GeoJSON, and the models, one per Tessera release and year to compare
	them, are kept for every resort. A prediction on the map shows where the classifier and
	OpenStreetMap disagree, which is where the next labels are worth drawing.
-->
<script lang="ts">
	import type { FeatureCollection } from 'geojson';
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { asset, resolve } from '$app/paths';
	import Button from '$lib/components/Button.svelte';
	import Combobox from '$lib/components/Combobox.svelte';
	import DataCredits from '$lib/components/DataCredits.svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import LabelMap from '$lib/components/LabelMap.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Select from '$lib/components/Select.svelte';
	import StatRow from '$lib/components/StatRow.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import { CREDITS, type Credit } from '$lib/credits';
	import { circleBounds, fitCircle, fitPoints } from '$lib/diorama/fit';
	import { isLocationId, locationUrls, type LocationFeatures } from '$lib/diorama/location';
	import { locationOptions } from '$lib/diorama/locations';
	import { BASEMAP_OPTIONS, type BasemapId } from '$lib/map/basemaps';
	import {
		SCENE_KINDS,
		classesForLabels,
		idFor,
		mergeClasses,
		newClass,
		type LabelClass
	} from '$lib/tessera/classes';
	import {
		DEFAULT_YEAR,
		labelledClasses,
		predict as runPrediction,
		trainModel
	} from '$lib/tessera/classify';
	import type { ClassifierModel } from '$lib/tessera/model';
	import {
		browserCache,
		DEFAULT_VERSION,
		TESSERA_RELEASES,
		TesseraStore,
		type TesseraVersion
	} from '$lib/tessera/store';
	import {
		labelsFile,
		loadClasses,
		loadModels,
		loadStored,
		readDropped,
		renameStoredLabels,
		store,
		storeClasses,
		storeModels,
		tally,
		type Box,
		type LabelFeature,
		type Prediction
	} from '$lib/tessera/labels';

	let { data } = $props();

	const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

	let locationId = $state(untrack(() => data.locationId));
	let local = $state(untrack(() => data.local));
	const resorts = $derived(locationOptions(data.locations));
	let features = $state.raw<LocationFeatures>(EMPTY);
	let scene = $state.raw<FeatureCollection & { metadata?: { bounds?: Box } }>(EMPTY);
	let loading = $state(false);
	let message = $state('');

	let labels = $state.raw<LabelFeature[]>(untrack(() => loadStored(data.locationId)));
	let prediction = $state.raw<Prediction | null>(null);
	/** What labels can be, here and at every resort; a resort's labels of others add theirs. */
	let classes = $state.raw<LabelClass[]>(
		untrack(() =>
			classesForLabels(
				labels.map((f) => f.properties.label),
				loadClasses()
			)
		)
	);
	let label = $state(untrack(() => classes[0].id));
	let editing = $state(false);
	let tool = $state<'area' | 'point'>('area');
	let basemap = $state<BasemapId>('satellite');
	let showLabels = $state(true);
	let showWoods = $state(true);
	let showPrediction = $state(true);
	let showProbability = $state(true);
	let confirmClear = $state(false);

	let models = $state.raw<ClassifierModel[]>(loadModels());
	let version = $state<TesseraVersion>(DEFAULT_VERSION);
	let year = $state(String(DEFAULT_YEAR));
	/** The years the release has embeddings for at the square; null while looking. */
	let years = $state.raw<number[] | null>(null);
	const model = $derived(
		models.find((m) => m.version === version && String(m.year) === year) ?? null
	);
	/** The last prediction made here, to export for the Snow Diorama. */
	let resultFile = $state.raw<object | null>(null);
	let busy = $state<'train' | 'predict' | null>(null);
	let progress = $state('');
	// What's been read is kept by the browser, so predicting again after training is quick.
	const cache = browserCache();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache, not state
	const stores = new Map<TesseraVersion, TesseraStore>();
	function tesseraStore(v: TesseraVersion) {
		let store = stores.get(v);
		if (!store) stores.set(v, (store = new TesseraStore({ version: v, cache })));
		return store;
	}
	const RELEASE_OPTIONS = Object.entries(TESSERA_RELEASES).map(([value, r]) => ({
		value: value as TesseraVersion,
		label: r.label
	}));

	// Each release is filled in a year at a time, so only some years have this square.
	$effect(() => {
		const b = bounds;
		const store = tesseraStore(version);
		if (!b) return;
		let stale = false;
		years = null;
		store.coverage(b).then(
			(ys) => {
				if (stale) return;
				years = ys;
				if (ys.length && !ys.includes(Number(untrack(() => year)))) year = String(ys.at(-1));
			},
			() => !stale && (years = [])
		);
		return () => (stale = true);
	});
	const yearOptions = $derived((years ?? [Number(year)]).map((y) => ({ value: String(y) })));
	const hasYear = $derived(!years || years.includes(Number(year)));

	/** Keeps a model, in place of any of the same release and year. */
	function keep(m: ClassifierModel) {
		models = [...models.filter((o) => o.version !== m.version || o.year !== m.year), m].sort(
			(a, b) => a.version.localeCompare(b.version) || a.year - b.year
		);
		storeModels(models);
	}

	function go(id: string) {
		id = id.trim();
		if (!isLocationId(id) || (id === locationId && !local)) return;
		locationId = id;
		local = false;
		labels = loadStored(id);
		setClasses(
			classesForLabels(
				labels.map((f) => f.properties.label),
				classes
			)
		);
		prediction = null;
		resultFile = null;
		progress = '';
	}

	// The runs, lifts and scene of the resort, from the app's files or snowline; not its terrain.
	$effect(() => {
		const id = locationId;
		const urls = locationUrls(id, local ? asset('/diorama/') : undefined);
		const controller = new AbortController();
		const json = (url: string) =>
			fetch(url, { signal: controller.signal }).then((r) =>
				r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(`${r.status} ${url}`))
			);
		loading = true;
		message = '';
		Promise.all([json(urls.features), json(urls.scene)]).then(
			([f, s]) => {
				if (controller.signal.aborted) return;
				loading = false;
				if (!f) message = `no data for ${id}`;
				features = f ?? EMPTY;
				scene = s ?? EMPTY;
				if (!s) message = `no scene for ${id}: run pnpm diorama-scene build`;
				const url = new URL(window.location.href);
				if (!local && url.searchParams.get('locationId') !== id) {
					url.searchParams.set('locationId', id);
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, query only
					replaceState(url, {});
				}
			},
			(e) => {
				if (controller.signal.aborted) return;
				loading = false;
				message = e instanceof Error ? e.message : String(e);
			}
		);
		return () => controller.abort();
	});

	/** The scene's square, as `pnpm diorama-scene` wrote it, or fitted around the runs and lifts. */
	const bounds = $derived.by<Box | null>(() => {
		if (scene.metadata?.bounds) return scene.metadata.bounds;
		const points = fitPoints(features);
		if (!points.length) return null;
		const circle = fitCircle(points);
		return circle.radius ? (circleBounds(circle) as Box) : null;
	});
	/** The classes traced as scene features, and the scene's own features of their kinds. */
	const mapped = $derived(classes.filter((c) => c.kind));
	const mappedNames = $derived(mapped.map((c) => c.name).join(', ') || 'nothing');
	const woods = $derived<FeatureCollection>({
		type: 'FeatureCollection',
		features: scene.features.filter((f) => mapped.some((c) => c.kind === f.properties?.kind))
	});
	const runs = $derived<FeatureCollection>({
		type: 'FeatureCollection',
		features: features.features.filter((f) => f.properties?.kind === 'runSegment')
	});
	const name = $derived(features.metadata?.name ?? locationId);

	const counts = $derived(tally(labels, classes));

	function setClasses(next: LabelClass[]) {
		classes = next;
		storeClasses(next);
		if (!next.some((c) => c.id === label)) label = next[0].id;
	}
	function updateClass(id: string, patch: Partial<LabelClass>) {
		setClasses(classes.map((c) => (c.id === id ? { ...c, ...patch } : c)));
	}
	/** A new name is a new id too, so the labels of it, here and at every resort, follow. */
	function renameClass(id: string, name: string) {
		name = name.trim();
		if (!name) return;
		const to = idFor(name, classes, id);
		updateClass(id, { name, id: to });
		if (to === id) return;
		renameStoredLabels(id, to);
		setLabels(
			labels.map((f) =>
				f.properties.label === id ? { ...f, properties: { ...f.properties, label: to } } : f
			)
		);
		if (label === id) label = to;
	}
	function addClass() {
		const c = newClass(classes);
		setClasses([...classes, c]);
		label = c.id;
	}
	const ha = (m2: number) => (m2 / 10_000).toFixed(m2 < 100_000 ? 2 : 1);

	function setLabels(next: LabelFeature[]) {
		labels = next;
		store(locationId, next);
	}

	const fileName = $derived(`${locationId}-tessera-labels.geojson`);

	function download(text: string, name: string, type = 'application/geo+json') {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([text], { type }));
		a.download = name;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	function exportLabels() {
		const file = labelsFile(labels, classes, { locationId, name, bounds: bounds ?? undefined });
		download(JSON.stringify(file, null, 1), fileName);
	}

	const canTrain = $derived(labelledClasses(labels, classes).length >= 2);

	async function train() {
		busy = 'train';
		progress = '';
		try {
			keep(
				await trainModel(tesseraStore(version), labels, {
					classes,
					year: Number(year),
					names: [fileName],
					onprogress: (m) => (progress = m)
				})
			);
			progress = '';
		} catch (e) {
			progress = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	async function predict() {
		if (!model || !bounds) return;
		busy = 'predict';
		progress = '';
		const id = locationId;
		try {
			const file = await runPrediction(tesseraStore(model.version), model, scene, {
				bounds,
				onprogress: (m) => (progress = m)
			});
			if (id !== locationId) return;
			const result = readDropped(file);
			if (result.type === 'prediction') prediction = result.prediction;
			resultFile = file;
			showPrediction = true;
			progress = '';
		} catch (e) {
			progress = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	async function dropped(files: File[]) {
		message = '';
		for (const file of files) {
			let result: ReturnType<typeof readDropped>;
			try {
				result = readDropped(JSON.parse(await file.text()));
			} catch {
				message = `${file.name} is not GeoJSON`;
				continue;
			}
			if (result.type === 'labels') {
				// The file's classes join the list, under their own definitions when it has none.
				setClasses(
					classesForLabels(
						result.labels.map((f) => f.properties.label),
						mergeClasses(classes, result.classes ?? [])
					)
				);
				// Labels for another resort switch to it; for this one they are added.
				if (result.locationId && result.locationId !== locationId) {
					go(result.locationId);
					setLabels(result.labels);
				} else {
					const have = new Set(labels.map((f) => f.properties.id));
					setLabels([...labels, ...result.labels.filter((f) => !have.has(f.properties.id))]);
				}
			} else if (result.type === 'prediction') {
				prediction = result.prediction;
				resultFile = null;
			} else if (result.type === 'model') {
				keep(result.model);
				setClasses(mergeClasses(classes, result.model.classes));
				version = result.model.version;
				year = String(result.model.year);
			} else {
				message = `${file.name} has no labels, prediction or model`;
			}
		}
	}

	const pct = (v: number | null | undefined) => (v == null ? '–' : Math.round(v * 100));
	const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

	const credits: Credit[] = [
		CREDITS.tessera,
		CREDITS.snowline,
		CREDITS.openSkiData,
		CREDITS.overture,
		CREDITS.esriImagery,
		CREDITS.openFreeMap
	];
</script>

<svelte:head><title>{data.tool.title} · {name} · Carto</title></svelte:head>

<section class="head">
	<h1>{data.tool.title}</h1>
	<div class="meta">
		<time datetime={data.tool.date}>{data.tool.date}</time>
		<span>{name}</span>
	</div>
	<p>
		The <a href={resolve('/diorama-snow')}>Snow Diorama</a> plants its trees in the woods OpenStreetMap
		has mapped, which miss many and invent some. Mark a few places of woods and a few of open ground,
		train a classifier on the Tessera embeddings under them, and let it find the rest.
	</p>
	<div class="location">
		<Combobox
			label="resort"
			placeholder={locationId}
			searchPlaceholder="search resorts"
			options={resorts}
			value={locationId}
			onchange={go}
		/>
		{#if loading || message}<div class="note">{loading ? 'loading…' : message}</div>{/if}
	</div>
</section>

<section>
	<div class="explorer">
		<div class="pane">
			<div class="map">
				<LabelMap
					{bounds}
					{woods}
					{runs}
					{labels}
					{prediction}
					{showLabels}
					{showWoods}
					{showPrediction}
					{showProbability}
					{basemap}
					{classes}
					{label}
					{tool}
					onadd={(f) => {
						setLabels([...labels, f]);
						// A label drawn while they are hidden would vanish as it is made.
						showLabels = true;
					}}
					onremove={(id) => setLabels(labels.filter((f) => f.properties.id !== id))}
				/>
			</div>
			<div class="note">
				{#if tool === 'area'}
					click the corners of an area, then its first corner or enter to close it · backspace takes
					one back · escape lets it go
				{:else}
					click to drop a point
				{/if}
				· click a label and press backspace to remove it
			</div>
		</div>
		<div class="panel">
			<div class="control">
				<span class="label">label</span>
				<Segmented
					label="label"
					options={classes.map((c) => ({ value: c.id, label: c.name, count: counts[c.id].count }))}
					bind:value={label}
				/>
				{#if editing}
					<div class="classes">
						{#each classes as c (c.id)}
							{@const used = counts[c.id].count}
							<div class="class">
								<input
									type="color"
									value={c.color}
									aria-label="{c.name} colour"
									onchange={(e) => updateClass(c.id, { color: e.currentTarget.value })}
								/>
								<input
									type="text"
									value={c.name}
									aria-label="{c.name} name"
									onchange={(e) => renameClass(c.id, e.currentTarget.value)}
								/>
								<Select
									options={[
										{ value: '', label: 'not mapped' },
										...SCENE_KINDS.map((k) => ({ value: k, label: `as ${k}` }))
									]}
									value={c.kind ?? ''}
									onchange={(k) => updateClass(c.id, { kind: k || undefined })}
								/>
								<button
									class="remove"
									aria-label="remove {c.name}"
									title={used ? `${used} labels here` : 'remove'}
									disabled={!!used || classes.length <= 2}
									onclick={() => setClasses(classes.filter((o) => o.id !== c.id))}>×</button
								>
							</div>
						{/each}
						<div class="note">
							a mapped class is traced as scene features of its kind · a class with labels here
							can't be removed
						</div>
					</div>
				{/if}
				<div class="actions">
					{#if editing}
						<Button size="sm" onclick={addClass}>add class</Button>
					{/if}
					<Button size="sm" onclick={() => (editing = !editing)}>
						{editing ? 'done' : 'edit classes'}
					</Button>
				</div>
			</div>
			<div class="control">
				<span class="label">draw</span>
				<Segmented
					label="draw"
					options={[{ value: 'area' }, { value: 'point' }]}
					bind:value={tool}
				/>
			</div>
			<div class="note tally">
				{#each classes as c (c.id)}
					<span
						><i class="swatch" style:background={c.color}></i>{c.name}
						{ha(counts[c.id].m2)} ha</span
					>
				{/each}
			</div>
			<div class="control">
				<span class="label">show</span>
				<Toggle label="labels" bind:checked={showLabels} />
				<Toggle label="openstreetmap {mappedNames}" bind:checked={showWoods} />
				{#if prediction}
					<Toggle label="predicted {mappedNames}" bind:checked={showPrediction} />
					{#if prediction.probability}
						<Toggle label="chance of {mappedNames}" bind:checked={showProbability} />
					{/if}
				{/if}
			</div>
			<Select label="basemap" options={BASEMAP_OPTIONS} bind:value={basemap} />
			<div class="actions">
				<Button variant="primary" disabled={!labels.length} onclick={exportLabels}>
					export labels
				</Button>
				{#if confirmClear}
					<Button
						variant="danger"
						onclick={() => {
							setLabels([]);
							confirmClear = false;
						}}>clear {labels.length}?</Button
					>
					<Button onclick={() => (confirmClear = false)}>keep</Button>
				{:else}
					<Button disabled={!labels.length} onclick={() => (confirmClear = true)}>clear</Button>
				{/if}
			</div>
			<div class="control">
				<span class="label">model</span>
				<div class="pickers">
					<Select label="tessera" options={RELEASE_OPTIONS} bind:value={version} />
					<Select label="year" options={yearOptions} bind:value={year} />
				</div>
				{#if years && !years.length}
					<div class="note">no tessera {TESSERA_RELEASES[version].label} embeddings here</div>
				{/if}
				<div class="actions">
					<Button variant="primary" disabled={!canTrain || !hasYear || !!busy} onclick={train}>
						{busy === 'train' ? 'training…' : 'train'}
					</Button>
					<Button disabled={!model || !bounds || !!busy} onclick={predict}>
						{busy === 'predict' ? 'predicting…' : 'predict'}
					</Button>
					{#if resultFile}
						<Button
							onclick={() => download(JSON.stringify(resultFile), `${locationId}-tessera.geojson`)}
						>
							export prediction
						</Button>
					{/if}
					{#if model}
						<Button
							onclick={() =>
								download(
									JSON.stringify(model, null, '\t'),
									`tessera-classifier-${model.version}-${model.year}.json`,
									'application/json'
								)}
						>
							export model
						</Button>
					{/if}
				</div>
				{#if progress}
					<div class="note">{progress}</div>
				{:else if model}
					{@const cv = model.crossValidation}
					<div class="note">
						{#if cv}
							{pct(cv.accuracy)}% right on held-out labels
							{#each model.classes as c (c.id)}
								<br />{c.name}: precision {pct(cv.classes[c.id]?.precision)}%, recall {pct(
									cv.classes[c.id]?.recall
								)}%
							{/each}
						{:else}
							label two areas of each class to measure its accuracy
						{/if}
						<br />trained {model.trainedAt.slice(0, 10)} on {sum(model.pixels).toLocaleString('en')} px
						of {model.classes.map((c) => c.name).join(', ')}
					</div>
				{/if}
				{#if models.length > 1 || (models.length && !model)}
					<div class="models">
						{#each models as m (`${m.version} ${m.year}`)}
							<button
								class:current={m === model}
								onclick={() => {
									version = m.version;
									year = String(m.year);
								}}
							>
								<span>{TESSERA_RELEASES[m.version].label} · {m.year}</span>
								<span>{m.crossValidation ? `${pct(m.crossValidation.accuracy)}%` : '–'}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<DropZone
				onfiles={dropped}
				accept={(n) => /\.(geo)?json$/i.test(n)}
				extensions=".geojson,.json"
				title="drop labels, a prediction or a model"
				hint="a labels export, a prediction or a model from train"
			/>
		</div>
	</div>
</section>

{#if prediction?.stats}
	<section>
		<div class="body">
			{#each prediction.classes ?? classes as c (c.id)}
				{@const st = prediction.stats[c.id]}
				{#if st}
					<StatRow
						stats={[
							{ value: pct(st.cover), unit: '%', label: `of the square ${c.name}` },
							{ value: pct(st.sceneCover), unit: '%', label: `openstreetmap ${c.name}` },
							{ value: pct(st.outsideScene), unit: '%', label: `${c.name} openstreetmap misses` },
							{ value: pct(st.sceneWithout), unit: '%', label: `openstreetmap ${c.name} not found` }
						]}
					/>
				{/if}
			{/each}
			<div class="note">{prediction.source}</div>
			<p class="lede">
				Where the white outlines and the dashed green ones part, one of them is wrong. Label a few
				of those places, train again and predict again. Export the prediction for the Snow Diorama's
				load tessera woods.
			</p>
		</div>
	</section>
{/if}

<DataCredits {credits} />

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
	.head .meta {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		font-size: var(--text-meta);
		color: var(--color-text-faint);
	}
	.head p,
	.lede {
		max-width: 560px;
		font-size: var(--text-content);
		line-height: 1.7;
		color: var(--color-text-tertiary);
	}
	.head a {
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 4px;
		text-decoration-color: var(--color-text-faint);
	}
	.location {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: min(360px, 100%);
	}
	section + section {
		margin-top: 72px;
	}
	.head + section {
		margin-top: 56px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.note {
		font-size: var(--text-small);
		line-height: 1.7;
		color: var(--color-text-tertiary);
	}
	.explorer {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 48px;
		align-items: start;
	}
	.pane {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}
	.map {
		height: 680px;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.control {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.label {
		font-size: var(--text-meta);
		letter-spacing: var(--tracking-label);
		text-transform: uppercase;
		color: var(--color-text-label);
	}
	.tally {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: -16px;
	}
	.swatch {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 8px;
		border-radius: 50%;
	}
	.classes {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.class {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) 112px 16px;
		gap: 8px;
		align-items: center;
	}
	.class input[type='color'] {
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.class input[type='color']::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	.class input[type='color']::-webkit-color-swatch {
		border: 0;
		border-radius: 50%;
	}
	.class input[type='text'] {
		min-width: 0;
		height: var(--control-height);
		padding: 0 10px;
		font: inherit;
		font-size: var(--text-small);
		color: var(--color-text-ui);
		background: var(--color-surface);
		border: 1px solid var(--color-line-strong);
		border-radius: 0;
	}
	.class input[type='text']:focus-visible {
		outline: none;
		border-color: var(--color-accent);
	}
	.remove {
		color: var(--color-text-tertiary);
		cursor: pointer;
	}
	.remove:hover:not(:disabled) {
		color: var(--color-text-secondary);
	}
	.remove:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.pickers {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.models {
		display: flex;
		flex-direction: column;
	}
	.models button {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		font-size: var(--text-small);
		color: var(--color-text-tertiary);
		cursor: pointer;
	}
	.models button:hover,
	.models .current {
		color: var(--color-text-secondary);
	}
	.models .current span:first-child::before {
		content: '› ';
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	@media (max-width: 899px) {
		.explorer {
			grid-template-columns: minmax(0, 1fr);
			gap: 32px;
		}
		.map {
			height: 520px;
		}
	}
	@media (max-width: 719px) {
		.head {
			padding-top: 48px;
		}
	}
</style>
