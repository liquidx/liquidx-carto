/**
 * Labels of what's where, drawn on the /tessera-classifier page and read by
 * `pnpm tessera-classifier train`: GeoJSON points and areas, each with a `label` naming one of
 * the classes, whose definitions the file carries in `metadata.classes` (see classes.ts). The
 * file is also what the geotessera classify examples read, as they take any Point with a
 * `label`.
 */
import type { Feature, FeatureCollection, Point, Polygon, Position } from 'geojson';
import type { ClassStats } from './classify.ts';
import { DEFAULT_CLASSES, isClass, labelId, type LabelClass } from './classes.ts';
import { isModel, type ClassifierModel } from './model.ts';

/** A label; one from a file of every resort's labels says which resort it was drawn at. */
export type LabelFeature = Feature<
	Point | Polygon,
	{ id: string; label: string; locationId?: string }
>;
export type Box = [west: number, south: number, east: number, north: number];

/** What a prediction from the page or `pnpm tessera-classifier predict` carries. */
export interface Prediction {
	/** Scene features of the mapped classes' kinds: woods as `kind: wood`. */
	features: FeatureCollection;
	source?: string;
	/** The scene square it was predicted over. */
	bounds?: Box;
	classes?: LabelClass[];
	/** By class id, for the mapped classes. */
	stats?: Record<string, ClassStats>;
	/** The chances as an image and its corners: top left, top right, bottom right, bottom left. */
	probability?: { image: string; coordinates: [Position, Position, Position, Position] };
}

/** Square metres in a polygon's outer ring less its holes, flat at its own latitude. */
export function areaM2(polygon: Polygon) {
	const [outer] = polygon.coordinates;
	if (!outer?.length) return 0;
	const lat = outer.reduce((s, p) => s + p[1], 0) / outer.length;
	const perLat = 111_320;
	const perLon = perLat * Math.cos((lat * Math.PI) / 180);
	const ring = (r: Position[]) => {
		let sum = 0;
		for (let i = 0, j = r.length - 1; i < r.length; j = i++)
			sum += (r[j][0] - r[i][0]) * perLon * (r[j][1] + r[i][1]) * perLat;
		return Math.abs(sum) / 2;
	};
	return polygon.coordinates.reduce((s, r, i) => s + (i ? -ring(r) : ring(r)), 0);
}

/** How many labels and how much area there is of each class, by id. */
export function tally(labels: LabelFeature[], classes: LabelClass[]) {
	const out: Record<string, { count: number; m2: number }> = Object.fromEntries(
		classes.map((c) => [c.id, { count: 0, m2: 0 }])
	);
	for (const f of labels) {
		const t = (out[f.properties.label] ??= { count: 0, m2: 0 });
		t.count++;
		if (f.geometry.type === 'Polygon') t.m2 += areaM2(f.geometry);
	}
	return out;
}

/** The labels as the file `pnpm tessera-classifier train` reads. */
export function labelsFile(
	labels: LabelFeature[],
	classes: LabelClass[],
	metadata: { locationId: string; name?: string; bounds?: Box }
): FeatureCollection & { metadata: object } {
	return {
		type: 'FeatureCollection',
		metadata: { ...metadata, exportedAt: new Date().toISOString(), classes },
		features: labels
	};
}

/**
 * The labels of every resort as one file for `pnpm tessera-classifier train`, each marked with
 * the resort it was drawn at, so a model learns from them all and the page can hand them back.
 */
export function everyLabelsFile(
	byLocation: Record<string, LabelFeature[]>,
	classes: LabelClass[]
): FeatureCollection & { metadata: object } {
	const ids = Object.keys(byLocation)
		.filter((id) => byLocation[id].length)
		.sort();
	return {
		type: 'FeatureCollection',
		metadata: { locations: ids, exportedAt: new Date().toISOString(), classes },
		features: ids.flatMap((locationId) =>
			byLocation[locationId].map((f) => ({ ...f, properties: { ...f.properties, locationId } }))
		)
	};
}

/**
 * What a dropped file is: labels (features with a `label` naming a class, from this page or
 * written by hand), a prediction (features with `metadata.probability` or `source: tessera`),
 * or a model.
 */
export function readDropped(
	data: unknown
):
	| { type: 'labels'; labels: LabelFeature[]; classes?: LabelClass[]; locationId?: string }
	| { type: 'prediction'; prediction: Prediction }
	| { type: 'model'; model: ClassifierModel }
	| { type: 'unknown' } {
	if (isModel(data)) return { type: 'model', model: data };
	const fc = data as FeatureCollection & { metadata?: Record<string, unknown> };
	if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return { type: 'unknown' };
	const labels = fc.features.filter(
		(f): f is LabelFeature =>
			typeof f.properties?.label === 'string' &&
			!!f.properties.label &&
			(f.geometry?.type === 'Point' || f.geometry?.type === 'Polygon')
	);
	if (labels.length)
		return {
			type: 'labels',
			labels: labels.map((f) => ({
				type: 'Feature',
				properties: {
					id: String(f.properties.id ?? newId()),
					// Labels from before the classes were renamed come back under the new names.
					label: labelId(f.properties.label),
					...(typeof f.properties.locationId === 'string' && {
						locationId: f.properties.locationId
					})
				},
				geometry: f.geometry
			})),
			classes: Array.isArray(fc.metadata?.classes)
				? (fc.metadata.classes as unknown[]).filter(isClass)
				: undefined,
			locationId: fc.metadata?.locationId as string | undefined
		};
	const meta = fc.metadata ?? {};
	if (meta.probability || fc.features.some((f) => f.properties?.source === 'tessera'))
		return {
			type: 'prediction',
			prediction: {
				features: { type: 'FeatureCollection', features: fc.features },
				source: meta.source as string | undefined,
				bounds: meta.bounds as Box | undefined,
				classes: meta.classes as LabelClass[] | undefined,
				stats: meta.stats as Prediction['stats'],
				probability: meta.probability as Prediction['probability']
			}
		};
	return { type: 'unknown' };
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Labels are kept in the browser per location, so a reload doesn't lose them. */
const storageKey = (locationId: string) => `tessera-classifier:labels:${locationId}`;
/** Where they were kept when this was the tree labeller. */
const oldKey = (locationId: string) => `tree-labels:${locationId}`;

export function loadStored(locationId: string): LabelFeature[] {
	try {
		const text =
			localStorage.getItem(storageKey(locationId)) ?? localStorage.getItem(oldKey(locationId));
		const result = text ? readDropped(JSON.parse(text)) : null;
		return result?.type === 'labels' ? result.labels : [];
	} catch {
		return [];
	}
}

export function store(locationId: string, labels: LabelFeature[]) {
	try {
		const key = storageKey(locationId);
		if (labels.length)
			localStorage.setItem(key, JSON.stringify({ type: 'FeatureCollection', features: labels }));
		else localStorage.removeItem(key);
		localStorage.removeItem(oldKey(locationId));
	} catch {
		// Private windows and full storage: the labels still live until the page closes.
	}
}

/** The labels kept here for every resort with any, by location id. */
export function loadAllStored(): Record<string, LabelFeature[]> {
	const out: Record<string, LabelFeature[]> = {};
	try {
		for (const prefix of [storageKey(''), oldKey('')])
			for (const key of Object.keys(localStorage)) {
				const id = key.slice(prefix.length);
				if (!key.startsWith(prefix) || id in out) continue;
				const labels = loadStored(id);
				if (labels.length) out[id] = labels;
			}
	} catch {
		// Blocked storage keeps nothing.
	}
	return out;
}

const MODELS_KEY = 'tessera-classifier:models';

/**
 * The models trained or dropped here, one per tessera release and year, kept for every resort:
 * one model maps them all.
 */
export function loadModels(): ClassifierModel[] {
	try {
		const models = JSON.parse(localStorage.getItem(MODELS_KEY) ?? '[]');
		return Array.isArray(models) ? models.filter(isModel) : [];
	} catch {
		return [];
	}
}

export function storeModels(models: ClassifierModel[]) {
	try {
		localStorage.setItem(MODELS_KEY, JSON.stringify(models));
	} catch {
		// As for labels: they last until the page closes.
	}
}

const CLASSES_KEY = 'tessera-classifier:classes';

/** The classes defined on the page, kept for every resort: one list labels them all. */
export function loadClasses(): LabelClass[] {
	try {
		const classes = JSON.parse(localStorage.getItem(CLASSES_KEY) ?? 'null');
		return Array.isArray(classes) && classes.length ? classes.filter(isClass) : DEFAULT_CLASSES;
	} catch {
		return DEFAULT_CLASSES;
	}
}

export function storeClasses(classes: LabelClass[]) {
	try {
		localStorage.setItem(CLASSES_KEY, JSON.stringify(classes));
	} catch {
		// As for labels: they last until the page closes.
	}
}

/** Relabels a renamed class's labels, at every resort with labels kept here. */
export function renameStoredLabels(from: string, to: string) {
	try {
		const prefix = storageKey('');
		for (const key of Object.keys(localStorage)) {
			if (!key.startsWith(prefix)) continue;
			const labels = loadStored(key.slice(prefix.length));
			if (labels.some((f) => f.properties.label === from))
				store(
					key.slice(prefix.length),
					labels.map((f) =>
						f.properties.label === from ? { ...f, properties: { ...f.properties, label: to } } : f
					)
				);
		}
	} catch {
		// Blocked storage has nothing kept to relabel.
	}
}
