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
		/** Where the mountain shows from, as pixels over the region box. */
		viewshed?: {
			pixels: Uint8ClampedArray;
			width: number;
			height: number;
			bounds: { west: number; east: number; north: number; south: number };
		} | null;
		/** The land from which the sun can sit on the summit on some day of the year. */
		sectors?: LngLat[][];
		onpick: (p: LngLat) => void;
		onspot?: (id: string) => void;
	};

	let {
		observer,
		locus,
		view = null,
		spots = [],
		viewshed = null,
		sectors = [],
		onpick,
		onspot
	}: Props = $props();

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
	const sectorShapes = (): GeoJSON.FeatureCollection => ({
		type: 'FeatureCollection',
		features: sectors.map((ring) => ({
			type: 'Feature',
			properties: {},
			geometry: { type: 'Polygon', coordinates: [ring.map((p) => [p.lon, p.lat])] }
		}))
	});
	/** The viewshed pixels as an image the map can drape over the region. */
	function viewshedUrl() {
		if (!viewshed) return null;
		const c = document.createElement('canvas');
		c.width = viewshed.width;
		c.height = viewshed.height;
		c.getContext('2d')!.putImageData(
			new ImageData(
				new Uint8ClampedArray(viewshed.pixels) as Uint8ClampedArray<ArrayBuffer>,
				viewshed.width,
				viewshed.height
			),
			0,
			0
		);
		return c.toDataURL();
	}
	const BLANK =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
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
			m.addSource('viewshed', {
				type: 'image',
				url: BLANK,
				coordinates: [
					[138, 36],
					[139, 36],
					[139, 35],
					[138, 35]
				]
			});
			m.addLayer(
				{
					id: 'viewshed',
					type: 'raster',
					source: 'viewshed',
					paint: { 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 }
				},
				basemaps.firstSymbol
			);
			m.addSource('sectors', { type: 'geojson', data: sectorShapes() });
			m.addLayer(
				{
					id: 'sectors',
					type: 'line',
					source: 'sectors',
					paint: {
						'line-color': '#e6e6ea',
						'line-width': 1,
						'line-opacity': 0.45,
						'line-dasharray': [4, 3]
					}
				},
				basemaps.firstSymbol
			);
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
		(map.getSource('sectors') as maplibregl.GeoJSONSource).setData(sectorShapes());
	});

	$effect(() => {
		if (!map || !ready) return;
		const src = map.getSource('viewshed') as maplibregl.ImageSource;
		const url = viewshedUrl();
		if (!url || !viewshed) {
			src.updateImage({ url: BLANK });
			return;
		}
		const b = viewshed.bounds;
		src.updateImage({
			url,
			coordinates: [
				[b.west, b.north],
				[b.east, b.north],
				[b.east, b.south],
				[b.west, b.south]
			]
		});
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
