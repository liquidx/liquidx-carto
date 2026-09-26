import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './maplibre.css';
// maplibre looks for its worker next to its own module, which doesn't exist once it's bundled
// into an app chunk. Bundle the worker (it imports a shared chunk) and point maplibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { BASE_STYLE } from './basemaps';

/**
 * A MapLibre map on carto's dark vector style, with zoom buttons and a metric scale. Give the
 * container the `carto-map` class for the matching control styles.
 */
export function createMap(
	container: HTMLElement,
	options: Omit<maplibregl.MapOptions, 'container' | 'style'> = {}
): maplibregl.Map {
	maplibregl.setWorkerUrl(workerUrl);
	const m = new maplibregl.Map({
		container,
		style: BASE_STYLE,
		attributionControl: { compact: true },
		...options
	});
	m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
	m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
	if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = m;
	return m;
}
