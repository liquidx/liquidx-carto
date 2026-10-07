import { describe, expect, it } from 'vitest';
import {
	applyVertical,
	buildDiorama,
	createSurface,
	dioramaMeta,
	shapesOf
} from '@liquidx/diorama';

const circle = { lon: 138.7, lat: 35.3, radius: 1000 };
// A plane rising eastwards and northwards, which a triangle mesh reproduces exactly.
const plane = (lon: number, lat: number) =>
	500 + (lon - circle.lon) * 20_000 + (lat - circle.lat) * 10_000;

function surfaceFor(exaggeration: number) {
	const data = buildDiorama(plane, circle, { rings: 6, segments: 16 });
	applyVertical(data, { exaggeration, baseDepth: 0.25 });
	const meta = dioramaMeta(data, {
		exaggeration,
		baseDepth: 0.25,
		contourInterval: 50,
		majorEvery: 5
	});
	return { data, surface: createSurface(data.geometry, meta) };
}

describe('createSurface', () => {
	it('maps longitude and latitude onto the unit disc, east +x and north -z', () => {
		const { surface } = surfaceFor(1);
		expect(surface.toModel([circle.lon, circle.lat])).toEqual([0, -0]);
		// 1000 m north is the rim: one degree of latitude is 111.32 km.
		const [x, z] = surface.toModel([circle.lon, circle.lat + 1000 / 111_320]);
		expect(x).toBeCloseTo(0);
		expect(z).toBeCloseTo(-1);
		expect(surface.toModel([circle.lon + 0.001, circle.lat])[0]).toBeGreaterThan(0);
		expect(surface.contains([circle.lon + 0.005, circle.lat])).toBe(true);
		expect(surface.contains([circle.lon + 0.02, circle.lat])).toBe(false);
		expect(surface.metres(500)).toBe(0.5);
	});

	it('reads elevation anywhere on the disc', () => {
		const { surface } = surfaceFor(1);
		const points = [
			[circle.lon, circle.lat],
			[circle.lon + 0.0007, circle.lat - 0.0004],
			[circle.lon - 0.006, circle.lat + 0.005],
			[circle.lon + 0.004, circle.lat + 0.0071],
			[circle.lon - 0.0101, circle.lat - 0.0012]
		];
		for (const p of points) {
			expect(surface.contains(p)).toBe(true);
			expect(surface.elevationAt(p)).toBeCloseTo(plane(p[0], p[1]), 1);
		}
	});

	it('projects onto the exaggerated surface, with altitude above it', () => {
		const { data, surface } = surfaceFor(2);
		const p = [circle.lon + 0.003, circle.lat + 0.002];
		const ground = ((plane(p[0], p[1]) - data.minZ) * 2) / circle.radius;
		expect(surface.project(p).y).toBeCloseTo(ground, 3);
		// 100 m up at 2× on a 1000 m radius is 0.2 units.
		expect(surface.project(p, 100).y).toBeCloseTo(ground + 0.2, 3);
		const [x, z] = surface.toModel(p);
		expect(surface.project(p).x).toBe(x);
		expect(surface.project(p).z).toBe(z);
	});
});

describe('shapesOf', () => {
	it('flattens collections, features, bare and multi geometries', () => {
		const road = {
			type: 'LineString' as const,
			coordinates: [
				[0, 0],
				[1, 1]
			]
		};
		const shapes = shapesOf([
			{
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: { name: 'a' },
						geometry: { type: 'Point', coordinates: [0, 0] }
					},
					{
						type: 'Feature',
						properties: { name: 'b' },
						geometry: {
							type: 'MultiPolygon',
							coordinates: [
								[
									[
										[0, 0],
										[1, 0],
										[1, 1],
										[0, 0]
									]
								],
								[
									[
										[2, 2],
										[3, 2],
										[3, 3],
										[2, 2]
									]
								]
							]
						}
					}
				]
			},
			road
		]);
		expect(shapes.map((s) => s.kind)).toEqual(['point', 'polygon', 'polygon', 'line']);
		expect(shapes[2].feature.properties).toEqual({ name: 'b' });
		expect(shapes[3].feature.geometry).toBe(road);
	});
});
