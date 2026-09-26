<!--
	MapLibre map of charging sites over a distance-to-nearest-charger field. The field is drawn as
	one polygon per grid cell, so MapLibre projects it exactly and restyling it (network, mode,
	threshold, opacity) is only a paint change. Click a site for its details; `probe` follows the
	pointer.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import { mount, onMount, unmount } from 'svelte';
	import type { FeatureCollection, Point, Polygon } from 'geojson';
	import ChargerCard from './ChargerCard.svelte';
	import { installBasemaps, showBasemap, type BasemapId, type Basemaps } from '$lib/map/basemaps';
	import { createMap } from '$lib/map/create';
	import type { Charger, Network } from '$lib/ev/model';
	import {
		AC_ONLY,
		BLACKSPOT,
		BLACKSPOT_STEP,
		FAST,
		GRADIENT,
		GRADIENT_STEP,
		RING,
		RING_24H
	} from '$lib/ev/style';

	type Props = {
		/** Land cells with `all` and `h24` distance properties (km). */
		cells: FeatureCollection<Polygon>;
		chargers: Charger[];
		network?: Network | 'off';
		mode?: 'gradient' | 'blackspots';
		/** Blackspot threshold, km. */
		threshold?: number;
		opacity?: number;
		basemap?: BasemapId;
		/** Initial view, [west, south, east, north]. */
		bounds: [number, number, number, number];
		probe?: { lon: number; lat: number } | null;
	};

	let {
		cells,
		chargers,
		network = 'all',
		mode = 'gradient',
		threshold = 25,
		opacity = 1,
		basemap = 'terrain',
		bounds,
		// Written, never read here: the parent binds it.
		// eslint-disable-next-line no-useless-assignment
		probe = $bindable(null)
	}: Props = $props();

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = $state.raw(null);
	let ready = $state(false);
	let basemaps: Basemaps | undefined;
	const empty = { type: 'FeatureCollection' as const, features: [] };

	export function fitBounds(b: [number, number, number, number], maxZoom = 11) {
		map?.fitBounds(b, { padding: 40, maxZoom, duration: 600 });
	}

	onMount(() => {
		const m = createMap(container, { bounds, fitBoundsOptions: { padding: 24 } });
		let popup: maplibregl.Popup | null = null;
		let card: ReturnType<typeof mount> | null = null;

		m.on('load', () => {
			basemaps = installBasemaps(m);
			m.addSource('field', { type: 'geojson', data: empty });
			m.addLayer(
				{
					id: 'field',
					type: 'fill',
					source: 'field',
					// Antialiased edges would print a hairline seam between every pair of cells.
					paint: { 'fill-antialias': false }
				},
				basemaps.firstSymbol
			);
			m.addSource('chargers', { type: 'geojson', data: empty });
			m.addLayer({
				id: 'chargers',
				type: 'circle',
				source: 'chargers',
				layout: { 'circle-sort-key': ['case', ['get', 'dc'], 1, 0] },
				paint: {
					'circle-color': ['case', ['get', 'dc'], FAST, AC_ONLY],
					'circle-radius': [
						'interpolate',
						['linear'],
						['zoom'],
						6,
						['case', ['get', 'dc'], 3.5, 2.2],
						12,
						['case', ['get', 'dc'], 6, 4]
					],
					'circle-stroke-color': ['case', ['get', 'h24'], RING_24H, RING],
					'circle-stroke-width': ['case', ['get', 'h24'], 1.5, 1]
				}
			});
			ready = true;
		});

		m.on('click', 'chargers', (e) => {
			const id = e.features?.[0]?.properties?.id;
			const c = chargers.find((x) => x.id === id);
			if (!c) return;
			popup?.remove();
			const el = document.createElement('div');
			card = mount(ChargerCard, { target: el, props: { charger: c } });
			popup = new maplibregl.Popup({ maxWidth: '320px', offset: 10 })
				.setLngLat([c.lon, c.lat])
				.setDOMContent(el)
				.addTo(m);
			popup.on('close', () => {
				if (card) unmount(card);
				card = null;
			});
		});
		m.on('mouseenter', 'chargers', () => (m.getCanvas().style.cursor = 'pointer'));
		m.on('mouseleave', 'chargers', () => (m.getCanvas().style.cursor = ''));
		m.on('mousemove', (e) => (probe = { lon: e.lngLat.lng, lat: e.lngLat.lat }));
		m.getCanvas().addEventListener('mouseleave', () => (probe = null));

		map = m;
		return () => {
			popup?.remove();
			m.remove();
			map = null;
			ready = false;
		};
	});

	$effect(() => {
		if (!map || !ready || !basemaps) return;
		showBasemap(map, basemaps, basemap, true);
	});

	$effect(() => {
		if (!map || !ready) return;
		(map.getSource('field') as maplibregl.GeoJSONSource).setData(cells);
	});

	$effect(() => {
		if (!map || !ready) return;
		const data: FeatureCollection<Point> = {
			type: 'FeatureCollection',
			features: chargers.map((c) => ({
				type: 'Feature',
				properties: { id: c.id, dc: c.dc, h24: c.open24h },
				geometry: { type: 'Point', coordinates: [c.lon, c.lat] }
			}))
		};
		(map.getSource('chargers') as maplibregl.GeoJSONSource).setData(data);
	});

	// Field styling: all paint and filter changes, no data reload.
	$effect(() => {
		if (!map || !ready) return;
		const m = map;
		m.setLayoutProperty('field', 'visibility', network === 'off' ? 'none' : 'visible');
		if (network === 'off') return;
		const d: maplibregl.ExpressionSpecification = ['get', network === '24h' ? 'h24' : 'all'];
		const steps = (colors: string[], by: number, v: maplibregl.ExpressionSpecification) =>
			[
				'step',
				v,
				colors[0],
				...colors.slice(1).flatMap((c, i) => [by * (i + 1), c])
			] as maplibregl.ExpressionSpecification;
		if (mode === 'blackspots') {
			m.setFilter('field', ['>=', d, threshold]);
			m.setPaintProperty(
				'field',
				'fill-color',
				steps(BLACKSPOT, BLACKSPOT_STEP, ['-', d, threshold])
			);
		} else {
			m.setFilter('field', null);
			m.setPaintProperty('field', 'fill-color', steps(GRADIENT, GRADIENT_STEP, d));
		}
		m.setPaintProperty('field', 'fill-opacity', opacity);
	});
</script>

<div class="map carto-map" bind:this={container}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
	}
</style>
