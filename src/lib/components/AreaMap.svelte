<!--
	MapLibre map for choosing an area. Shows a switchable basemap (dark OpenFreeMap with optional
	global hillshade, or a raster street / topo / satellite map), hillshaded DEM tiles, and an
	aspect-locked frame. While `drawing`, drag to draw a new frame; otherwise drag inside the
	frame to move it, or its edge to resize it. With `shape="circle"` the frame is a square and
	the circle inscribed in it is shown instead: draw from the centre out, resize at the rim.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
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
	import { installBasemaps, showBasemap, type BasemapId, type Basemaps } from '$lib/map/basemaps';
	import { createMap } from '$lib/map/create';

	type Props = {
		frame?: Frame | null;
		/** Output width / height; the frame always has this aspect. Ignored for circles. */
		aspect?: number;
		shape?: 'rect' | 'circle';
		drawing?: boolean;
		demTiles?: TileMeta[];
		/** Show hillshade from global terrain tiles (for the API source, `terrain` basemap only). */
		terrain?: boolean;
		basemap?: BasemapId;
	};

	let {
		frame = $bindable(null),
		aspect: rectAspect = 1,
		shape = 'rect',
		drawing = $bindable(false),
		demTiles = [],
		terrain = true,
		basemap = 'terrain'
	}: Props = $props();

	const ACCENT = '#36b6e9';

	const circle = $derived(shape === 'circle');
	const aspect = $derived(circle ? 1 : rectAspect);

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = $state.raw(null);
	let ready = $state(false);
	let basemaps: Basemaps | undefined;
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

	const toMerc = (ll: maplibregl.LngLat) => ({ x: lonToX(ll.lng), y: latToY(ll.lat) });
	const ring = (b: MercatorBox): [number, number][] =>
		[
			[b.x0, b.y0],
			[b.x1, b.y0],
			[b.x1, b.y1],
			[b.x0, b.y1],
			[b.x0, b.y0]
		].map(([x, y]) => [xToLon(x), yToLat(y)]);
	/** The circle inscribed in a square box, closed. */
	const circleRing = (b: MercatorBox, n = 128): [number, number][] => {
		const cx = (b.x0 + b.x1) / 2;
		const cy = (b.y0 + b.y1) / 2;
		const r = (b.x1 - b.x0) / 2;
		return Array.from({ length: n + 1 }, (_, i) => {
			const t = (i / n) * Math.PI * 2;
			return [xToLon(cx + r * Math.cos(t)), yToLat(cy + r * Math.sin(t))];
		});
	};
	/** Grip positions: box corners, or the circle's compass points. */
	const grips = (b: MercatorBox): [number, number][] => {
		if (!circle) return ring(b).slice(0, 4);
		const cx = (b.x0 + b.x1) / 2;
		const cy = (b.y0 + b.y1) / 2;
		return [
			[cx, b.y0],
			[b.x1, cy],
			[cx, b.y1],
			[b.x0, cy]
		].map(([x, y]) => [xToLon(x), yToLat(y)]);
	};

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
		const m = createMap(container, { center: [138.7274, 35.3606], zoom: 10 });

		m.on('load', () => {
			basemaps = installBasemaps(m);
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
			if (circle) return Math.hypot(p.x - frame.cx, p.y - frame.cy) <= frame.w / 2;
			const b = frameBox(frame, aspect);
			return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
		};

		/** Which edge/corner of the frame is under a screen point, if any. */
		const hitHandle = (pt: maplibregl.Point, touch: boolean): Handle => {
			if (!frame) return '';
			const b = frameBox(frame, aspect);
			const tol = touch ? 14 : 6;
			if (circle) {
				const c = m.project([xToLon(frame.cx), yToLat(frame.cy)]);
				const r = m.project([xToLon(b.x1), yToLat(frame.cy)]).x - c.x;
				const dx = pt.x - c.x;
				const dy = pt.y - c.y;
				if (Math.abs(Math.hypot(dx, dy) - r) > tol) return '';
				// The compass direction of the rim point, for the cursor.
				const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
				return (['w', 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)[octant + 4];
			}
			const tl = m.project([xToLon(b.x0), yToLat(b.y0)]);
			const br = m.project([xToLon(b.x1), yToLat(b.y1)]);
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
			if (circle) {
				// The centre stays put; the rim follows the pointer.
				const w = Math.max(min, 2 * Math.hypot(p.x - frame.cx, p.y - frame.cy));
				frame = { cx: frame.cx, cy: frame.cy, w };
			} else if (handle.length === 2) {
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
			} else if (mode === 'draw' && circle) {
				const w = 2 * Math.hypot(p.x - anchor.x, p.y - anchor.y);
				if (w > 0) frame = { cx: anchor.x, cy: anchor.y, w };
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
		if (!map || !ready || !basemaps) return;
		showBasemap(map, basemaps, basemap, terrain);
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
		const r = circle ? circleRing(b) : ring(b);
		grips(b).forEach((ll, k) => corners[k].setLngLat(ll).addTo(map!));
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

<div class="map carto-map" bind:this={container}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
	}
	.map :global(.frame-grip) {
		width: 8px;
		height: 8px;
		background: var(--color-accent);
		pointer-events: none;
	}
</style>
