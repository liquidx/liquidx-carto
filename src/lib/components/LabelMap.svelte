<!--
	MapLibre map for labelling what's where, for the Tessera classifier. Shows the scene's square,
	the woods OpenStreetMap maps there and the ski runs, over a switchable basemap (satellite by
	default), with a prediction on top when one is given. Click to drop a
	point, or to add the corners of an area: click its first corner, double-click or press enter
	to close it, escape to let it go and backspace to take back a corner. Clicking a label
	selects it, and backspace or delete removes it.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import { onMount } from 'svelte';
	import type { FeatureCollection, Position } from 'geojson';
	import { installBasemaps, showBasemap, type BasemapId, type Basemaps } from '$lib/map/basemaps';
	import { createMap } from '$lib/map/create';
	import type { LabelClass } from '$lib/tessera/classes';
	import { newId, type Box, type LabelFeature, type Prediction } from '$lib/tessera/labels';

	type Props = {
		/** The scene's square, which the map fits to when it changes. */
		bounds: Box | null;
		/** OpenStreetMap's woods, from the scene. */
		woods: FeatureCollection;
		runs: FeatureCollection;
		labels: LabelFeature[];
		prediction?: Prediction | null;
		/** Hidden labels can't be clicked, so can't be selected or removed either. */
		showLabels?: boolean;
		showWoods?: boolean;
		showPrediction?: boolean;
		showProbability?: boolean;
		basemap?: BasemapId;
		/** What labels can be, for their colours. */
		classes: LabelClass[];
		/** The class id new labels get. */
		label: string;
		tool: 'area' | 'point';
		onadd: (f: LabelFeature) => void;
		onremove: (id: string) => void;
	};

	let {
		bounds,
		woods,
		runs,
		labels,
		prediction = null,
		showLabels = true,
		showWoods = true,
		showPrediction = true,
		showProbability = true,
		basemap = 'satellite',
		classes,
		label,
		tool,
		onadd,
		onremove
	}: Props = $props();

	const WOOD = '#9be7b0';
	const UNKNOWN = '#9a9aa5';
	const PREDICTED = '#f2f2f5';
	const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = $state.raw(null);
	let ready = $state(false);
	let basemaps: Basemaps | undefined;
	/** The corners of the area being drawn, and where the pointer is. */
	let corners = $state.raw<Position[]>([]);
	let cursor = $state.raw<Position | null>(null);
	let selected = $state<string | null>(null);

	/** Each label in its class's colour; grey for a class that's gone. */
	function colorOf(list: LabelClass[]): maplibregl.ExpressionSpecification | string {
		if (!list.length) return UNKNOWN;
		const [first, ...rest] = list;
		return [
			'match',
			['get', 'label'],
			first.id,
			first.color,
			...rest.flatMap((c) => [c.id, c.color]),
			UNKNOWN
		];
	}

	const source = (id: string) => map?.getSource(id) as maplibregl.GeoJSONSource | undefined;
	const vis = (on: boolean) => (on ? 'visible' : 'none');

	function finish() {
		// A double-click lands its two clicks on the same spot.
		const ring = corners.filter(
			(c, i) => !i || c[0] !== corners[i - 1][0] || c[1] !== corners[i - 1][1]
		);
		if (ring.length >= 3)
			onadd({
				type: 'Feature',
				properties: { id: newId(), label },
				geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
			});
		corners = [];
	}

	onMount(() => {
		const m = createMap(container, {
			center: [140.967, 39.987],
			zoom: 13,
			doubleClickZoom: false
		});
		m.on('load', () => {
			basemaps = installBasemaps(m);
			for (const id of ['mask', 'woods', 'runs', 'predicted', 'labels', 'draft'])
				m.addSource(id, { type: 'geojson', data: empty });
			m.addLayer({
				id: 'mask',
				type: 'fill',
				source: 'mask',
				paint: { 'fill-color': '#000000', 'fill-opacity': 0.45 }
			});
			m.addLayer({
				id: 'woods',
				type: 'line',
				source: 'woods',
				paint: { 'line-color': WOOD, 'line-width': 1, 'line-dasharray': [3, 2] }
			});
			m.addLayer({
				id: 'runs',
				type: 'line',
				source: 'runs',
				paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.35 }
			});
			m.addLayer({
				id: 'predicted',
				type: 'line',
				source: 'predicted',
				paint: { 'line-color': PREDICTED, 'line-width': 1.2 }
			});
			const color = colorOf(classes);
			const isSelected: maplibregl.ExpressionSpecification = ['get', 'selected'];
			m.addLayer({
				id: 'label-fill',
				type: 'fill',
				source: 'labels',
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: { 'fill-color': color, 'fill-opacity': ['case', isSelected, 0.55, 0.3] }
			});
			m.addLayer({
				id: 'label-line',
				type: 'line',
				source: 'labels',
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: { 'line-color': color, 'line-width': ['case', isSelected, 3, 1.5] }
			});
			m.addLayer({
				id: 'label-point',
				type: 'circle',
				source: 'labels',
				filter: ['==', ['geometry-type'], 'Point'],
				paint: {
					'circle-color': color,
					'circle-radius': ['case', isSelected, 7, 5],
					'circle-stroke-color': '#08080a',
					'circle-stroke-width': 1.5
				}
			});
			m.addLayer({
				id: 'draft-line',
				type: 'line',
				source: 'draft',
				paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 2] }
			});
			m.addLayer({
				id: 'draft-corner',
				type: 'circle',
				source: 'draft',
				filter: ['==', ['geometry-type'], 'Point'],
				paint: { 'circle-color': '#ffffff', 'circle-radius': 3.5 }
			});
			ready = true;
		});

		const labelLayers = ['label-fill', 'label-point'];
		m.on('click', (e) => {
			const at: Position = [e.lngLat.lng, e.lngLat.lat];
			if (!corners.length) {
				const hit = m.queryRenderedFeatures(e.point, { layers: labelLayers })[0];
				if (hit) {
					selected = String(hit.properties.id);
					return;
				}
				selected = null;
				if (tool === 'point') {
					onadd({
						type: 'Feature',
						properties: { id: newId(), label },
						geometry: { type: 'Point', coordinates: at }
					});
					return;
				}
			}
			// Back on the first corner closes the area.
			if (corners.length >= 3) {
				const first = m.project(corners[0] as [number, number]);
				if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 10) return finish();
			}
			corners = [...corners, at];
		});
		m.on('dblclick', (e) => {
			e.preventDefault();
			// The double-click's first click has added a corner already.
			finish();
		});
		m.on('mousemove', (e) => {
			cursor = [e.lngLat.lng, e.lngLat.lat];
			const over = !corners.length && m.queryRenderedFeatures(e.point, { layers: labelLayers });
			m.getCanvas().style.cursor = over && over.length ? 'pointer' : 'crosshair';
		});
		m.on('mouseout', () => (cursor = null));

		const onkey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest('input, textarea, select, [contenteditable]')) return;
			if (e.key === 'Escape') {
				corners = [];
				selected = null;
			} else if (e.key === 'Enter' && corners.length) {
				finish();
			} else if (e.key === 'Backspace' || e.key === 'Delete') {
				if (corners.length) corners = corners.slice(0, -1);
				else if (selected) {
					onremove(selected);
					selected = null;
				} else return;
				e.preventDefault();
			}
		};
		window.addEventListener('keydown', onkey);
		map = m;
		return () => {
			window.removeEventListener('keydown', onkey);
			m.remove();
		};
	});

	// The scene's square, with everything outside it dimmed, and the view fitted to it.
	$effect(() => {
		if (!map || !ready || !bounds) return;
		const [w, s, e, n] = bounds;
		source('mask')?.setData({
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[-180, -85],
						[180, -85],
						[180, 85],
						[-180, 85],
						[-180, -85]
					],
					[
						[w, s],
						[w, n],
						[e, n],
						[e, s],
						[w, s]
					]
				]
			}
		});
		map.fitBounds([w, s, e, n], { padding: 24, duration: 0 });
	});

	$effect(() => {
		if (!map || !ready) return;
		source('woods')?.setData(woods);
		source('runs')?.setData(runs);
	});

	$effect(() => {
		if (!map || !ready) return;
		const color = colorOf(classes);
		map.setPaintProperty('label-fill', 'fill-color', color);
		map.setPaintProperty('label-line', 'line-color', color);
		map.setPaintProperty('label-point', 'circle-color', color);
	});

	$effect(() => {
		if (!map || !ready) return;
		// The selected label is drawn stronger.
		source('labels')?.setData({
			type: 'FeatureCollection',
			features: labels.map((f) => ({
				...f,
				properties: { ...f.properties, selected: f.properties.id === selected }
			}))
		});
	});

	// The area being drawn: its corners, and a line on to the pointer and back to the start.
	$effect(() => {
		if (!map || !ready) return;
		const path = cursor && corners.length ? [...corners, cursor] : corners;
		source('draft')?.setData({
			type: 'FeatureCollection',
			features: [
				...(path.length > 1
					? [
							{
								type: 'Feature' as const,
								properties: {},
								geometry: {
									type: 'LineString' as const,
									coordinates: path.length > 2 ? [...path, corners[0]] : path
								}
							}
						]
					: []),
				...corners.map((c) => ({
					type: 'Feature' as const,
					properties: {},
					geometry: { type: 'Point' as const, coordinates: c }
				}))
			]
		});
	});

	// The prediction: its woods traced in white, and the probability under them.
	$effect(() => {
		if (!map || !ready) return;
		source('predicted')?.setData(prediction?.features ?? empty);
		if (map.getLayer('probability')) map.removeLayer('probability');
		if (map.getSource('probability')) map.removeSource('probability');
		const p = prediction?.probability;
		if (!p) return;
		map.addSource('probability', {
			type: 'image',
			url: p.image,
			coordinates: p.coordinates as [
				[number, number],
				[number, number],
				[number, number],
				[number, number]
			]
		});
		map.addLayer(
			{
				id: 'probability',
				type: 'raster',
				source: 'probability',
				paint: { 'raster-opacity': 0.5, 'raster-resampling': 'nearest' }
			},
			'woods'
		);
	});

	$effect(() => {
		if (!map || !ready) return;
		const hasProbability = !!prediction?.probability;
		for (const id of ['label-fill', 'label-line', 'label-point'])
			map.setLayoutProperty(id, 'visibility', vis(showLabels));
		map.setLayoutProperty('woods', 'visibility', vis(showWoods));
		map.setLayoutProperty('predicted', 'visibility', vis(showPrediction));
		if (hasProbability) map.setLayoutProperty('probability', 'visibility', vis(showProbability));
	});

	$effect(() => {
		if (!map || !ready || !basemaps) return;
		showBasemap(map, basemaps, basemap, false);
	});

	// Another tool lets go of a half-drawn area rather than closing it as something else.
	$effect(() => {
		void tool;
		corners = [];
	});
</script>

<div class="map carto-map" bind:this={container}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
	}
</style>
