import { describe, expect, it } from 'vitest';
import { DEFAULT_CLASSES, classesForLabels, idFor } from './classes';
import { areaM2, everyLabelsFile, readDropped, tally, type LabelFeature } from './labels';

/** A square of about 100 m a side at the equator. */
const square = (lon: number, lat: number, d = 0.0009) => [
	[lon, lat],
	[lon + d, lat],
	[lon + d, lat + d],
	[lon, lat + d],
	[lon, lat]
];

describe('areaM2', () => {
	it('measures a ring, less its holes', () => {
		const outer = areaM2({ type: 'Polygon', coordinates: [square(0, 0)] });
		expect(outer).toBeCloseTo(10_040, -2);
		const holed = areaM2({
			type: 'Polygon',
			coordinates: [square(0, 0), square(0.0003, 0.0003, 0.0003)]
		});
		expect(holed).toBeCloseTo(outer * (8 / 9), -1);
	});
});

describe('readDropped', () => {
	it('reads labels and keeps their ids, under the classes as they are named now', () => {
		const result = readDropped({
			type: 'FeatureCollection',
			metadata: { locationId: 'niseko' },
			features: [
				{
					type: 'Feature',
					properties: { label: 'trees', id: 'a' },
					geometry: { type: 'Point', coordinates: [0, 0] }
				},
				{
					type: 'Feature',
					properties: { label: 'forest' },
					geometry: { type: 'Point', coordinates: [0, 0] }
				}
			]
		});
		expect(result.type).toBe('labels');
		if (result.type !== 'labels') return;
		expect(result.locationId).toBe('niseko');
		// Any class a label names is kept: the file may define it, or the page add it.
		expect(result.labels.map((f) => f.properties.label)).toEqual(['woods', 'forest']);
		expect(result.labels[0].properties.id).toBe('a');
	});

	it('reads back the labels of every resort, each marked with its resort', () => {
		const point = (id: string, label: string): LabelFeature => ({
			type: 'Feature',
			properties: { id, label },
			geometry: { type: 'Point', coordinates: [0, 0] }
		});
		const file = everyLabelsFile(
			{ niseko: [point('a', 'woods')], appi: [point('b', 'open')], empty: [] },
			DEFAULT_CLASSES
		);
		expect(file.metadata).toMatchObject({ locations: ['appi', 'niseko'] });
		const result = readDropped(JSON.parse(JSON.stringify(file)));
		if (result.type !== 'labels') throw new Error(result.type);
		expect(result.locationId).toBeUndefined();
		expect(result.labels.map((f) => [f.properties.id, f.properties.locationId])).toEqual([
			['b', 'appi'],
			['a', 'niseko']
		]);
	});

	it('tells a prediction from a scene', () => {
		const wood = (source?: string) => ({
			type: 'Feature',
			properties: { kind: 'wood', source },
			geometry: { type: 'Polygon', coordinates: [square(0, 0)] }
		});
		expect(readDropped({ type: 'FeatureCollection', features: [wood('tessera')] }).type).toBe(
			'prediction'
		);
		expect(readDropped({ type: 'FeatureCollection', features: [wood()] }).type).toBe('unknown');
	});
});

describe('tally', () => {
	it('counts points and sums areas by label', () => {
		const labels: LabelFeature[] = [
			{
				type: 'Feature',
				properties: { id: '1', label: 'open' },
				geometry: { type: 'Point', coordinates: [0, 0] }
			},
			{
				type: 'Feature',
				properties: { id: '2', label: 'open' },
				geometry: { type: 'Polygon', coordinates: [square(0, 0)] }
			}
		];
		const t = tally(labels, DEFAULT_CLASSES);
		expect(t.open.count).toBe(2);
		expect(t.woods.count).toBe(0);
		expect(t.open.m2).toBeGreaterThan(10_000);
	});
});

describe('classes', () => {
	it('names ids after classes, apart from the others', () => {
		expect(idFor('Rock & Scree', DEFAULT_CLASSES)).toBe('rock-scree');
		expect(idFor('Woods', DEFAULT_CLASSES)).toBe('woods-2');
		expect(idFor('Woods', DEFAULT_CLASSES, 'woods')).toBe('woods');
	});

	it('adds a class for each label the list lacks', () => {
		const out = classesForLabels(['trees', 'water', 'water'], DEFAULT_CLASSES);
		expect(out.map((c) => c.id)).toEqual(['woods', 'open', 'water']);
		expect(out[2].kind).toBeUndefined();
	});
});
