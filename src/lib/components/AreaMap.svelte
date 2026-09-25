<!--
	MapLibre map for choosing an area. Shows a switchable basemap (dark OpenFreeMap with optional
	global hillshade, or a raster street / topo / satellite map), hillshaded DEM tiles, and an
	aspect-locked frame. While `drawing`, drag to draw
	a new frame; otherwise drag inside the frame to move it.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// maplibre looks for its worker next to its own module, which doesn't exist once it's bundled
	// into an app chunk. Bundle the worker (it imports a shared chunk) and point maplibre at it.
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import { onMount } from 'svelte';
	import type { TileMeta, LngLatBounds } from '$lib/dem/store.svelte';
	import {
		frameBox,
		latToY,
		lonToX,
		xToLon,
		yToLat,
		type Frame,
		type MercatorBox
	} from '$lib/contour/mercator';
	import { RASTER_BASEMAPS, type BasemapId } from '$lib/contour/basemaps';

	type Props = {
		frame?: Frame | null;
		/** Output width / height; the frame always has this aspect. */
		aspect: number;
		drawing?: boolean;
		demTiles?: TileMeta[];
		/** Show hillshade from global terrain tiles (for the API source, `terrain` basemap only). */
		terrain?: boolean;
		basemap?: BasemapId;
	};

	let {
		frame = $bindable(null),
		aspect,
		drawing = $bindable(false),
		demTiles = [],
		terrain = true,
		basemap = 'terrain'
	}: Props = $props();

	const ACCENT = '#36b6e9';

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = $state.raw(null);
	let ready = $state(false);
	/** Layers of the OpenFreeMap style itself, captured before ours are added. */
	let styleLayers: { id: string; type: string }[] = [];
	// Square grips on the frame corners. Purely visual: pointer events go to the map, which
	// hit-tests edges and corners itself.
	const corners = Array.from({ length: 4 }, () => {
		const el = document.createElement('div');
		el.className = 'frame-grip';
		return new maplibregl.Marker({ element: el });
	});
	// MapLibre bookkeeping, deliberately non-reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const overlays = new Map<string, string>();

	type Handle = '' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
	const CURSORS: Record<Exclude<Handle, ''>, string> = {
		n: 'ns-resize',
		s: 'ns-resize',
		e: 'ew-resize',
		w: 'ew-resize',
		ne: 'nesw-resize',
		sw: 'nesw-resize',
		nw: 'nwse-resize',
		se: 'nwse-resize'
	};

	type PaintProperty = Parameters<maplibregl.Map['setPaintProperty']>[1];
	/** Paint overrides for the OpenFreeMap dark style. */
	const BASE_PAINT: [layer: string, prop: PaintProperty, value: string][] = [
		['background', 'background-color', '#27272c'],
		['water', 'fill-color', '#18222b'],
		['waterway', 'line-color', '#18222b'],
		['landcover_wood', 'fill-color', '#2f2f34'],
		['landuse_park', 'fill-color', '#2f2f34'],
		['building', 'fill-color', '#202024']
	];

	const toMerc = (ll: maplibregl.LngLat) => ({ x: lonToX(ll.lng), y: latToY(ll.lat) });
	const ring = (b: MercatorBox): [number, number][] =>
		[
			[b.x0, b.y0],
			[b.x1, b.y0],
			[b.x1, b.y1],
			[b.x0, b.y1],
			[b.x0, b.y0]
		].map(([x, y]) => [xToLon(x), yToLat(y)]);

	export function fitBounds(b: LngLatBounds) {
		map?.fitBounds([b.west, b.south, b.east, b.north], { padding: 48, duration: 600 });
	}

	export function showFrame() {
		if (!map || !frame) return;
		const b = frameBox(frame, aspect);
		map.fitBounds([xToLon(b.x0), yToLat(b.y1), xToLon(b.x1), yToLat(b.y0)], {
			padding: 64,
			duration: 600
		});
	}

	onMount(() => {
		maplibregl.setWorkerUrl(workerUrl);
		const m = new maplibregl.Map({
			container,
			// OpenFreeMap: free vector basemap, no key.
			style: 'https://tiles.openfreemap.org/styles/dark',
			center: [138.7274, 35.3606],
			zoom: 10,
			attributionControl: { compact: true }
		});
		m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
		m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

		m.on('load', () => {
			// The stock dark style is near-black; lift it so terrain shading reads clearly.
			for (const [id, prop, value] of BASE_PAINT)
				if (m.getLayer(id)) m.setPaintProperty(id, prop, value);
			// Light labels with a dark halo stay legible over the brighter hillshade.
			for (const l of m.getStyle().layers) {
				if (l.type !== 'symbol' || !l.layout?.['text-field']) continue;
				m.setPaintProperty(l.id, 'text-color', '#c9c9d0');
				m.setPaintProperty(l.id, 'text-halo-color', 'rgba(8, 8, 10, 0.85)');
				m.setPaintProperty(l.id, 'text-halo-width', 1.2);
			}
			styleLayers = m.getStyle().layers.map((l) => ({ id: l.id, type: l.type }));
			const firstSymbol = styleLayers.find((l) => l.type === 'symbol')?.id;
			// Raster basemaps sit over the vector fills but under its labels; only one is shown.
			for (const b of RASTER_BASEMAPS) {
				m.addSource(`base-${b.id}`, {
					type: 'raster',
					tiles: b.tiles,
					tileSize: b.tileSize,
					maxzoom: b.maxzoom,
					attribution: b.attribution
				});
				m.addLayer(
					{
						id: `base-${b.id}`,
						type: 'raster',
						source: `base-${b.id}`,
						layout: { visibility: 'none' }
					},
					firstSymbol
				);
			}
			// Global hillshade from terrain tiles, under the basemap labels.
			m.addSource('dem', {
				type: 'raster-dem',
				tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
				encoding: 'terrarium',
				tileSize: 256,
				maxzoom: 15,
				attribution: 'Terrain Tiles · Mapzen'
			});
			m.addLayer(
				{
					id: 'hillshade',
					type: 'hillshade',
					source: 'dem',
					layout: { visibility: terrain ? 'visible' : 'none' },
					paint: {
						'hillshade-exaggeration': 0.8,
						'hillshade-shadow-color': '#050506',
						'hillshade-highlight-color': '#f2f2f5',
						'hillshade-accent-color': '#000000'
					}
				},
				firstSymbol
			);
			const empty = { type: 'FeatureCollection' as const, features: [] };
			m.addSource('frame', { type: 'geojson', data: empty });
			m.addSource('mask', { type: 'geojson', data: empty });
			m.addLayer({
				id: 'mask',
				type: 'fill',
				source: 'mask',
				paint: { 'fill-color': '#000000', 'fill-opacity': 0.35 }
			});
			m.addLayer({
				id: 'frame-line',
				type: 'line',
				source: 'frame',
				paint: { 'line-color': ACCENT, 'line-width': 1.5 }
			});
			ready = true;
		});

		// Drawing: anchor a corner and drag the opposite one, aspect locked.
		// Resizing: drag an edge or corner; the opposite side stays put, aspect locked.
		// Moving: drag from inside the frame.
		let mode: 'draw' | 'move' | 'resize' | null = null;
		let handle: Handle = '';
		let anchor = { x: 0, y: 0 };
		let grab = { dx: 0, dy: 0 };

		const inside = (p: { x: number; y: number }) => {
			if (!frame) return false;
			const b = frameBox(frame, aspect);
			return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
		};

		/** Which edge/corner of the frame is under a screen point, if any. */
		const hitHandle = (pt: maplibregl.Point, touch: boolean): Handle => {
			if (!frame) return '';
			const b = frameBox(frame, aspect);
			const tl = m.project([xToLon(b.x0), yToLat(b.y0)]);
			const br = m.project([xToLon(b.x1), yToLat(b.y1)]);
			const tol = touch ? 14 : 6;
			const inX = pt.x >= tl.x - tol && pt.x <= br.x + tol;
			const inY = pt.y >= tl.y - tol && pt.y <= br.y + tol;
			const v =
				inX && Math.abs(pt.y - tl.y) <= tol ? 'n' : inX && Math.abs(pt.y - br.y) <= tol ? 's' : '';
			const h =
				inY && Math.abs(pt.x - tl.x) <= tol ? 'w' : inY && Math.abs(pt.x - br.x) <= tol ? 'e' : '';
			return (v + h) as Handle;
		};

		/** Smallest frame width: 24 screen pixels at the current zoom. */
		const minWidth = () => 24 / (512 * 2 ** m.getZoom());

		const resize = (p: { x: number; y: number }) => {
			if (!frame) return;
			const b = frameBox(frame, aspect);
			const min = minWidth();
			if (handle.length === 2) {
				// Corner: anchor is the opposite corner; grow towards the handle's direction.
				const sx = handle.includes('e') ? 1 : -1;
				const sy = handle.includes('s') ? 1 : -1;
				const w = Math.max(min, (p.x - anchor.x) * sx, (p.y - anchor.y) * sy * aspect);
				frame = { cx: anchor.x + (sx * w) / 2, cy: anchor.y + (sy * w) / aspect / 2, w };
			} else if (handle === 'e' || handle === 'w') {
				const w = Math.max(min, handle === 'e' ? p.x - b.x0 : b.x1 - p.x);
				frame = { cx: handle === 'e' ? b.x0 + w / 2 : b.x1 - w / 2, cy: frame.cy, w };
			} else {
				const w = Math.max(min, (handle === 's' ? p.y - b.y0 : b.y1 - p.y) * aspect);
				const h = w / aspect;
				frame = { cx: frame.cx, cy: handle === 's' ? b.y0 + h / 2 : b.y1 - h / 2, w };
			}
		};

		const start = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
			if ('points' in e && e.points.length > 1) return;
			const p = toMerc(e.lngLat);
			const hit = drawing ? '' : hitHandle(e.point, e.type === 'touchstart');
			if (drawing) {
				mode = 'draw';
				anchor = p;
			} else if (hit && frame) {
				mode = 'resize';
				handle = hit;
				const b = frameBox(frame, aspect);
				anchor = { x: hit.includes('e') ? b.x0 : b.x1, y: hit.includes('s') ? b.y0 : b.y1 };
			} else if (frame && inside(p)) {
				mode = 'move';
				grab = { dx: frame.cx - p.x, dy: frame.cy - p.y };
			} else return;
			// Stops MapLibre from starting a drag-pan for this gesture.
			e.preventDefault();
		};
		const move = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
			const p = toMerc(e.lngLat);
			if (!mode) {
				if (e.type === 'mousemove') {
					const hit = drawing ? '' : hitHandle(e.point, false);
					m.getCanvas().style.cursor = drawing
						? 'crosshair'
						: hit
							? CURSORS[hit]
							: inside(p)
								? 'move'
								: '';
				}
				return;
			}
			if (mode === 'move' && frame) {
				frame = { cx: p.x + grab.dx, cy: p.y + grab.dy, w: frame.w };
			} else if (mode === 'resize') {
				resize(p);
			} else if (mode === 'draw') {
				const dx = p.x - anchor.x;
				const dy = p.y - anchor.y;
				const w = Math.max(Math.abs(dx), Math.abs(dy) * aspect);
				if (w <= 0) return;
				const h = w / aspect;
				frame = {
					cx: anchor.x + (Math.sign(dx) || 1) * (w / 2),
					cy: anchor.y + (Math.sign(dy) || 1) * (h / 2),
					w
				};
			}
		};
		const end = () => {
			if (mode === 'draw') drawing = false;
			mode = null;
			handle = '';
		};
		m.on('mousedown', start);
		m.on('touchstart', start);
		m.on('mousemove', move);
		m.on('touchmove', move);
		m.on('mouseup', end);
		m.on('touchend', end);
		m.getCanvas().addEventListener('mouseleave', end);

		map = m;
		if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = m;
		return () => {
			m.remove();
			map = null;
			ready = false;
			overlays.clear();
		};
	});

	$effect(() => {
		if (!map) return;
		map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
	});

	$effect(() => {
		if (!map || !ready) return;
		const m = map;
		const vis = (on: boolean) => (on ? 'visible' : 'none');
		const raster = RASTER_BASEMAPS.find((b) => b.id === basemap);
		for (const b of RASTER_BASEMAPS)
			m.setLayoutProperty(`base-${b.id}`, 'visibility', vis(b === raster));
		// A raster basemap replaces the vector style, except labels where the raster has none.
		for (const l of styleLayers)
			m.setLayoutProperty(
				l.id,
				'visibility',
				vis(!raster || (raster.labels && l.type === 'symbol'))
			);
		m.setLayoutProperty('hillshade', 'visibility', vis(terrain && !raster));
	});

	// Hillshaded DEM tiles as image sources, below the mask.
	$effect(() => {
		if (!map || !ready) return;
		const m = map;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping
		const seen = new Set<string>();
		for (const t of demTiles) {
			if (!t.previewUrl) continue;
			const id = `dem-${t.id}`;
			seen.add(id);
			if (overlays.get(id) === t.previewUrl) continue;
			const coordinates: [[number, number], [number, number], [number, number], [number, number]] =
				[
					[t.west, t.north],
					[t.east, t.north],
					[t.east, t.south],
					[t.west, t.south]
				];
			const src = m.getSource(id) as maplibregl.ImageSource | undefined;
			if (src) src.updateImage({ url: t.previewUrl, coordinates });
			else {
				m.addSource(id, { type: 'image', url: t.previewUrl, coordinates });
				m.addLayer(
					{
						id,
						type: 'raster',
						source: id,
						paint: {
							'raster-fade-duration': 0,
							'raster-brightness-max': 0.92,
							'raster-contrast': 0.08
						}
					},
					'mask'
				);
			}
			overlays.set(id, t.previewUrl);
		}
		for (const id of [...overlays.keys()]) {
			if (seen.has(id)) continue;
			if (m.getLayer(id)) m.removeLayer(id);
			if (m.getSource(id)) m.removeSource(id);
			overlays.delete(id);
		}
	});

	// Frame outline, and a dimming mask over everything outside it.
	$effect(() => {
		if (!map || !ready) return;
		const b = frame ? frameBox(frame, aspect) : null;
		const frameSrc = map.getSource('frame') as maplibregl.GeoJSONSource;
		const maskSrc = map.getSource('mask') as maplibregl.GeoJSONSource;
		if (!b) {
			for (const c of corners) c.remove();
			frameSrc.setData({ type: 'FeatureCollection', features: [] });
			maskSrc.setData({ type: 'FeatureCollection', features: [] });
			return;
		}
		const r = ring(b);
		r.slice(0, 4).forEach((ll, k) => corners[k].setLngLat(ll).addTo(map!));
		frameSrc.setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'LineString', coordinates: r }
		});
		maskSrc.setData({
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
					r
				]
			}
		});
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
		background: var(--color-map-ink);
	}
	.map :global(.frame-grip) {
		width: 8px;
		height: 8px;
		background: var(--color-accent);
		pointer-events: none;
	}
	/* Quiet the MapLibre chrome to match the page. */
	.map :global(.maplibregl-ctrl-group) {
		background: var(--color-surface);
		border-radius: 0;
		box-shadow: none;
		border: 1px solid var(--color-line-strong);
	}
	.map :global(.maplibregl-ctrl-group button + button) {
		border-top: 1px solid var(--color-line);
	}
	.map :global(.maplibregl-ctrl-group button .maplibregl-ctrl-icon) {
		filter: invert(0.8);
	}
	.map :global(.maplibregl-ctrl-scale) {
		background: rgba(8, 8, 10, 0.6);
		color: var(--color-text-tertiary);
		border-color: var(--color-text-faint);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.map :global(.maplibregl-ctrl-attrib) {
		background: rgba(8, 8, 10, 0.6);
		color: var(--color-text-faint);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.map :global(.maplibregl-ctrl-attrib a) {
		color: var(--color-text-tertiary);
	}
</style>
