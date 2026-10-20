<!--
	A map around Fuji, in one of two framings. `region` takes in the mountain, the land the sun
	can set on its summit from, and where you stand; click anywhere to move there. `local` is
	close in on where you stand, with a pin to drag to the exact spot.

	Both draw the line of sight to the summit and the direction of the sun, from where you stand,
	at the moment it is the summit's height above the horizon: on the chosen day, and at the
	solstices either side of it.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import { onMount } from 'svelte';
	import { installBasemaps, showBasemap } from '$lib/map/basemaps';
	import { createMap } from '$lib/map/create';
	import { FUJI } from './alignment';
	import { destination, distance, type LngLat } from './geo';

	export type SunRay = { bearing: number; label: string; strong: boolean };

	type Props = {
		kind: 'region' | 'local';
		observer: LngLat;
		locus: LngLat[];
		/** Directions of the sun from the observer, drawn as rays. */
		rays?: SunRay[];
		/** Where the 3D view is looking, drawn as a wedge. */
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
		kind,
		observer,
		locus,
		rays = [],
		view = null,
		spots = [],
		viewshed = null,
		sectors = [],
		onpick,
		onspot
	}: Props = $props();

	const ACCENT = '#36b6e9';
	const SUN = '#d0a24c';
	const SIGHT = '#e6e6ea';
	const BLOCKED = '#7a7a84';
	/** How far the rays reach, in metres: past Fuji on the region map, off the edge close in. */
	const RAY_LENGTH = $derived(kind === 'region' ? 160_000 : 12_000);
	/** Labels sit partway out, inside the frame: halfway to Fuji on the region map. */
	const LABEL_AT = $derived(
		kind === 'region' ? Math.max(6_000, distance(observer, FUJI) * 0.5) : 450
	);

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = $state.raw(null);
	let ready = $state(false);

	// The framing is fixed for the life of the map.
	// svelte-ignore state_referenced_locally
	const local = kind === 'local';
	const observerMarker = new maplibregl.Marker({
		element: square(local ? 'observer-pin' : 'observer-mark'),
		draggable: local
	});
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
	const rayShapes = (): GeoJSON.FeatureCollection => ({
		type: 'FeatureCollection',
		features: rays.flatMap((r) => {
			const end = destination(observer, r.bearing, RAY_LENGTH);
			const at = destination(observer, r.bearing, LABEL_AT);
			return [
				{
					type: 'Feature' as const,
					properties: { strong: r.strong },
					geometry: {
						type: 'LineString' as const,
						coordinates: [
							[observer.lon, observer.lat],
							[end.lon, end.lat]
						]
					}
				},
				{
					type: 'Feature' as const,
					properties: { strong: r.strong, label: r.label },
					geometry: { type: 'Point' as const, coordinates: [at.lon, at.lat] }
				}
			];
		})
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
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
	const points = (): GeoJSON.FeatureCollection => ({
		type: 'FeatureCollection',
		features: spots.map((s) => ({
			type: 'Feature',
			properties: { id: s.id, clear: s.clear },
			geometry: { type: 'Point', coordinates: [s.lon, s.lat] }
		}))
	});
	/** The wedge the 3D view takes in, out to the summit and a little past. */
	function wedge(): [number, number][] {
		if (!view) return [];
		const pts: [number, number][] = [[observer.lon, observer.lat]];
		for (let i = 0; i <= 12; i++) {
			const b = view.bearing - view.hfov / 2 + (view.hfov * i) / 12;
			const p = destination(observer, b, RAY_LENGTH);
			pts.push([p.lon, p.lat]);
		}
		pts.push([observer.lon, observer.lat]);
		return pts;
	}

	/** The region framing: the mountain and the observer, with room around them. */
	function regionBounds(): maplibregl.LngLatBoundsLike {
		const pad = 0.25;
		return [
			[Math.min(FUJI.lon, observer.lon) - pad, Math.min(FUJI.lat, observer.lat) - pad],
			[Math.max(FUJI.lon, observer.lon) + pad, Math.max(FUJI.lat, observer.lat) + pad]
		];
	}

	onMount(() => {
		const m = createMap(container, {
			...(kind === 'region'
				? { bounds: regionBounds(), fitBoundsOptions: { padding: 32 }, minZoom: 5 }
				: { center: [observer.lon, observer.lat], zoom: 14 }),
			// A page that scrolls past the map shouldn't be caught by it: zoom with ctrl / two fingers.
			cooperativeGestures: true,
			dragRotate: false,
			pitchWithRotate: false
		});
		m.touchZoomRotate.disableRotation();
		m.on('load', () => {
			const basemaps = installBasemaps(m);
			showBasemap(m, basemaps, 'terrain', true);
			const below = basemaps.firstSymbol;
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
					paint: {
						'raster-opacity': 0.5,
						'raster-resampling': 'linear',
						'raster-fade-duration': 0
					}
				},
				below
			);
			m.addSource('sectors', { type: 'geojson', data: sectorShapes() });
			m.addLayer(
				{
					id: 'sectors-fill',
					type: 'fill',
					source: 'sectors',
					paint: { 'fill-color': SUN, 'fill-opacity': 0.12 }
				},
				below
			);
			m.addLayer(
				{
					id: 'sectors',
					type: 'line',
					source: 'sectors',
					paint: { 'line-color': SUN, 'line-width': 1.5, 'line-opacity': 0.7 }
				},
				below
			);
			m.addSource('wedge', { type: 'geojson', data: polygon([]) });
			m.addLayer(
				{
					id: 'wedge',
					type: 'fill',
					source: 'wedge',
					paint: { 'fill-color': ACCENT, 'fill-opacity': 0.06 }
				},
				below
			);
			m.addSource('locus', { type: 'geojson', data: line([]) });
			m.addLayer(
				{
					id: 'locus',
					type: 'line',
					source: 'locus',
					paint: { 'line-color': ACCENT, 'line-width': kind === 'local' ? 3 : 2 }
				},
				below
			);
			m.addSource('rays', { type: 'geojson', data: rayShapes() });
			m.addLayer({
				id: 'rays',
				type: 'line',
				source: 'rays',
				filter: ['==', ['geometry-type'], 'LineString'],
				paint: {
					'line-color': SUN,
					'line-width': ['case', ['get', 'strong'], 1.5, 1],
					'line-opacity': ['case', ['get', 'strong'], 0.95, 0.45],
					'line-dasharray': [3, 2]
				}
			});
			m.addLayer({
				id: 'ray-labels',
				type: 'symbol',
				source: 'rays',
				filter: ['==', ['geometry-type'], 'Point'],
				layout: {
					'text-field': ['get', 'label'],
					'text-font': ['Noto Sans Regular'],
					'text-size': 11,
					'text-allow-overlap': true
				},
				paint: {
					'text-color': SUN,
					'text-opacity': ['case', ['get', 'strong'], 1, 0.6],
					'text-halo-color': '#08080a',
					'text-halo-width': 1.5
				}
			});
			m.addSource('sight', { type: 'geojson', data: line([]) });
			m.addLayer({
				id: 'sight',
				type: 'line',
				source: 'sight',
				paint: { 'line-color': SIGHT, 'line-width': 1.5, 'line-opacity': 0.85 }
			});
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
			// Markers need a position before they join the map, or every map move throws.
			fujiMarker.setLngLat([FUJI.lon, FUJI.lat]).addTo(m);
			observerMarker.setLngLat([observer.lon, observer.lat]).addTo(m);
			ready = true;
		});
		observerMarker.on('dragend', () => {
			const p = observerMarker.getLngLat();
			onpick({ lon: p.lng, lat: p.lat });
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

	// Follow the observer: close in, keep them centred; on the region, only when they leave it.
	$effect(() => {
		if (!map || !ready) return;
		const { lon, lat } = observer;
		observerMarker.setLngLat([lon, lat]);
		(map.getSource('sight') as maplibregl.GeoJSONSource).setData(
			line([
				[lon, lat],
				[FUJI.lon, FUJI.lat]
			])
		);
		if (kind === 'local') map.easeTo({ center: [lon, lat], duration: 400 });
		else if (!map.getBounds().contains([lon, lat]))
			map.fitBounds(regionBounds(), { padding: 32, duration: 600 });
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
		void [rays, observer];
		(map.getSource('rays') as maplibregl.GeoJSONSource).setData(rayShapes());
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
		void [view, observer];
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
	.map :global(.observer-pin) {
		width: 16px;
		height: 16px;
		background: var(--color-accent);
		outline: 3px solid var(--color-base);
		cursor: grab;
	}
	.map :global(.observer-pin:active) {
		cursor: grabbing;
	}
	.map :global(.fuji-mark) {
		width: 0;
		height: 0;
		border-left: 7px solid transparent;
		border-right: 7px solid transparent;
		border-bottom: 12px solid var(--color-text);
		pointer-events: none;
	}
</style>
