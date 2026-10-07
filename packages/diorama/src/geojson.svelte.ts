import type { Feature } from 'geojson';
import { shapesOf, type GeoJSONInput, type Shape } from './geojson.js';

/** GeoJSON as a layer component takes it: the data itself, or a URL to fetch it from. */
export type GeoJSONSource = GeoJSONInput | string | null | undefined;

/** A layer prop that is one value for everything, or a function choosing per feature. */
export type PerFeature<T> = T | ((feature: Feature) => T);

export function perFeature<T>(value: PerFeature<T>, feature: Feature): T {
	return typeof value === 'function' ? (value as (feature: Feature) => T)(feature) : value;
}

/**
 * The shapes a layer component should show: its `data` (fetched when it is a URL), flattened
 * and filtered. Call during component initialisation; `current` is reactive.
 */
export function featureShapes(
	source: () => GeoJSONSource,
	filter: () => ((feature: Feature) => boolean) | undefined
): { readonly current: Shape[] } {
	let fetched = $state.raw<GeoJSONInput | null>(null);
	$effect(() => {
		const url = source();
		if (typeof url !== 'string') return;
		let cancelled = false;
		fetch(url)
			.then((r) => {
				if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
				return r.json();
			})
			.then((json) => {
				if (!cancelled) fetched = json;
			})
			.catch((e) => console.error(`Diorama: could not load ${url}`, e));
		return () => {
			cancelled = true;
			fetched = null;
		};
	});

	const shapes = $derived.by(() => {
		const data = source();
		const all = shapesOf(typeof data === 'string' ? fetched : data);
		const keep = filter();
		return keep ? all.filter((shape) => keep(shape.feature)) : all;
	});

	return {
		get current() {
			return shapes;
		}
	};
}
