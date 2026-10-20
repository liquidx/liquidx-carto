<!--
	The region around Fuji: the observer (click anywhere to move it), the line of sight to the
	summit, and the line of places the sun sets on the summit from on the chosen day.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import { onMount } from 'svelte';
	import { installBasemaps, showBasemap, type Basemaps } from '$lib/map/basemaps';
	import { createMap } from '$lib/map/create';
	import { FUJI } from './alignment';
	import { destination, type LngLat } from './geo';

	type Props = {
		observer: LngLat;
		locus: LngLat[];
		/** The lens in the preview: its bearing and horizontal angle of view, drawn as a wedge. */
		view?: { bearing: number; hfov: number } | null;
		/** Places found along the line, drawn as points; `clear` ones have the summit in sight. */
		spots?: { id: string; lon: number; lat: number; clear: boolean }[];
		onpick: (p: LngLat) => void;
		onspot?: (id: string) => void;
	};

	let { observer, locus, view = null, spots = [], onpick, onspot }: Props = $props();

	const ACCENT = '#36b6e9';
	const SIGHT = '#c9c9d0';
	const BLOCKED = '#7a7a84';

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = $state.raw(null);
	let ready = $state(false);
	let basemaps: Basemaps | undefined;

	const observerMarker = new maplibregl.Marker({ element: square('observer-mark') });
	const fujiMarker = new maplibregl.Marker({ element: square('fuji-mark') });

	function square(className: string) {
		const el = document.createElement('div');
		el.className = className;
		return el;
	}

	const line = (coords: [number, number][]): GeoJSON.Feature => ({
		type: 'Feature',
		properties: {},
		geometry: { type: 'LineString', coordinates: coords }
	});
	const polygon = (coords: [number, number][]): GeoJSON.Feature => ({
		type: 'Feature',
		properties: {},
		geometry: { type: 'Polygon', coordinates: coords.length ? [coords] : [] }
	});
	const points = (): GeoJSON.FeatureCollection => ({
		type: 'FeatureCollection',
		features: spots.map((s) => ({
			type: 'Feature',
			properties: { id: s.id, clear: s.clear },
			geometry: { type: 'Point', coordinates: [s.lon, s.lat] }
		}))
	});
	/** The wedge the lens sees, out to 150 km. */
	function wedge(): [number, number][] {
		if (!view) return [];
		const pts: [number, number][] = [[observer.lon, observer.lat]];
		for (let i = 0; i <= 12; i++) {
			const b = view.bearing - view.hfov / 2 + (view.hfov * i) / 12;
			const p = destination(observer, b, 150_000);
			pts.push([p.lon, p.lat]);
		}
		pts.push([observer.lon, observer.lat]);
		return pts;
	}

	onMount(() => {
		const m = createMap(container, { center: [139.3, 35.5], zoom: 7.4, minZoom: 5 });
		m.on('load', () => {
			basemaps = installBasemaps(m);
			showBasemap(m, basemaps, 'terrain', true);
			m.addSource('locus', { type: 'geojson', data: line([]) });
			m.addSource('sight', { type: 'geojson', data: line([]) });
			m.addSource('wedge', { type: 'geojson', data: polygon([]) });
			m.addLayer(
				{
					id: 'wedge',
					type: 'fill',
					source: 'wedge',
					paint: { 'fill-color': ACCENT, 'fill-opacity': 0.08 }
				},
				basemaps.firstSymbol
			);
			m.addLayer(
				{
					id: 'wedge-edge',
					type: 'line',
					source: 'wedge',
					paint: { 'line-color': ACCENT, 'line-width': 1, 'line-opacity': 0.35 }
				},
				basemaps.firstSymbol
			);
			m.addLayer(
				{
					id: 'locus',
					type: 'line',
					source: 'locus',
					paint: { 'line-color': ACCENT, 'line-width': 2 }
				},
				basemaps.firstSymbol
			);
			m.addLayer(
				{
					id: 'sight',
					type: 'line',
					source: 'sight',
					paint: {
						'line-color': SIGHT,
						'line-width': 1,
						'line-opacity': 0.7,
						'line-dasharray': [2, 3]
					}
				},
				basemaps.firstSymbol
			);
			m.addSource('spots', { type: 'geojson', data: points() });
			m.addLayer({
				id: 'spots',
				type: 'circle',
				source: 'spots',
				paint: {
					'circle-radius': 5,
					'circle-color': ['case', ['get', 'clear'], ACCENT, BLOCKED],
					'circle-stroke-color': '#08080a',
					'circle-stroke-width': 1.5
				}
			});
			m.on('mouseenter', 'spots', () => (m.getCanvas().style.cursor = 'pointer'));
			m.on('mouseleave', 'spots', () => (m.getCanvas().style.cursor = 'crosshair'));
			fujiMarker.setLngLat([FUJI.lon, FUJI.lat]).addTo(m);
			observerMarker.addTo(m);
			ready = true;
		});
		m.on('click', (e) => {
			const hit = m.getLayer('spots')
				? m.queryRenderedFeatures(e.point, { layers: ['spots'] })
				: [];
			if (hit.length && onspot) onspot(String(hit[0].properties.id));
			else onpick({ lon: e.lngLat.lng, lat: e.lngLat.lat });
		});
		m.getCanvas().style.cursor = 'crosshair';
		map = m;
		return () => {
			ready = false;
			m.remove();
		};
	});

	$effect(() => {
		if (!map || !ready) return;
		observerMarker.setLngLat([observer.lon, observer.lat]);
		(map.getSource('sight') as maplibregl.GeoJSONSource).setData(
			line([
				[observer.lon, observer.lat],
				[FUJI.lon, FUJI.lat]
			])
		);
	});

	$effect(() => {
		if (!map || !ready) return;
		(map.getSource('spots') as maplibregl.GeoJSONSource).setData(points());
	});

	$effect(() => {
		if (!map || !ready) return;
		void view;
		(map.getSource('wedge') as maplibregl.GeoJSONSource).setData(polygon(wedge()));
	});

	$effect(() => {
		if (!map || !ready) return;
		(map.getSource('locus') as maplibregl.GeoJSONSource).setData(
			line(locus.map((p) => [p.lon, p.lat]))
		);
	});
</script>

<div class="map carto-map" bind:this={container}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
	}
	.map :global(.observer-mark) {
		width: 10px;
		height: 10px;
		background: var(--color-accent);
		outline: 2px solid var(--color-base);
		pointer-events: none;
	}
	.map :global(.fuji-mark) {
		width: 0;
		height: 0;
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-bottom: 10px solid var(--color-text);
		pointer-events: none;
	}
</style>
