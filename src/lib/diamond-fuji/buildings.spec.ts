import { describe, expect, it } from 'vitest';
import {
	anchorOf,
	buildingGeometry,
	decodeTile,
	obstruction,
	sightlineTiles,
	tileAt,
	tileBounds,
	tilesAlong,
	tilesAround,
	type RawTile
} from './buildings';
import { destination } from './geo';

const TOKYO = { lon: 139.7671, lat: 35.6812 };
const flat = () => 10;

/** ECEF of a point on the WGS84 ellipsoid. */
function ecef(lon: number, lat: number) {
	const A = 6378137,
		e2 = 0.00669437999014;
	const p = (lat * Math.PI) / 180,
		l = (lon * Math.PI) / 180;
	const N = A / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
	return [N * Math.cos(p) * Math.cos(l), N * Math.cos(p) * Math.sin(l), N * (1 - e2) * Math.sin(p)];
}

/** A tile with boxes, each `size` metres square and `height` tall, at east/north offsets. */
function boxes(
	tile: { z: number; x: number; y: number },
	anchor: { lon: number; lat: number },
	list: { e: number; n: number; size: number; height: number }[]
): RawTile {
	const positions: number[] = [];
	const index: number[] = [];
	const featureIds: number[] = [];
	list.forEach((b, f) => {
		const base = positions.length / 3;
		const h = b.size / 2;
		for (const z of [0, b.height])
			for (const [dx, dy] of [
				[-h, -h],
				[h, -h],
				[h, h],
				[-h, h]
			]) {
				positions.push(b.e + dx, b.n + dy, z);
				featureIds.push(f + 7);
			}
		// four walls and a roof
		for (let i = 0; i < 4; i++) {
			const j = (i + 1) % 4;
			index.push(base + i, base + j, base + 4 + j, base + i, base + 4 + j, base + 4 + i);
		}
		index.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
	});
	const [tx, ty, tz] = ecef(anchor.lon, anchor.lat);
	const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
	return {
		positions: Float32Array.from(positions),
		index: Uint32Array.from(index),
		featureIds,
		matrix
	};
}

describe('tiles', () => {
	it('addresses web-mercator tiles', () => {
		const t = tileAt(TOKYO.lon, TOKYO.lat, 14);
		expect(t).toEqual({ z: 14, x: 14552, y: 6451 });
		const b = tileBounds(t);
		expect(b.west).toBeLessThan(TOKYO.lon);
		expect(b.east).toBeGreaterThan(TOKYO.lon);
		expect(b.south).toBeLessThan(TOKYO.lat);
		expect(b.north).toBeGreaterThan(TOKYO.lat);
	});
	it('covers a radius and a corridor', () => {
		expect(tilesAround(TOKYO, 14, 3_000).length).toBeGreaterThanOrEqual(9);
		const along = tilesAlong(TOKYO, 250, 6_000, 80, 13);
		expect(along.length).toBeGreaterThanOrEqual(2);
		expect(along.length).toBeLessThanOrEqual(6);
		expect(sightlineTiles(TOKYO, 250).some((t) => t.z === 12)).toBe(true);
	});
});

describe('decoding', () => {
	const tile = tileAt(TOKYO.lon, TOKYO.lat, 14);
	it('reads the anchor either way up', () => {
		const [x, y, z] = ecef(TOKYO.lon, TOKYO.lat);
		const asIs = anchorOf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1], tile);
		expect(asIs.lon).toBeCloseTo(TOKYO.lon, 5);
		expect(asIs.lat).toBeCloseTo(TOKYO.lat, 5);
		// The y-up form 3D Tiles asks for: ECEF = (x, −z_g, y_g), so the GLB holds (x, z, −y).
		const yUp = anchorOf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, z, -y, 1], tile);
		expect(yUp.lon).toBeCloseTo(TOKYO.lon, 5);
		expect(yUp.lat).toBeCloseTo(TOKYO.lat, 5);
	});
	it('puts buildings where they are and measures them', () => {
		const raw = boxes(tile, TOKYO, [
			{ e: 0, n: 0, size: 20, height: 30 },
			{ e: 300, n: 0, size: 40, height: 100 }
		]);
		const t = decodeTile(raw, tile);
		expect(t.features).toHaveLength(2);
		expect(t.features[0].lon).toBeCloseTo(TOKYO.lon, 5);
		expect(t.features[0].height).toBe(30);
		expect(t.features[0].radius).toBeCloseTo(Math.SQRT2 * 10, 0);
		expect(t.features[1].height).toBe(100);
		const east = destination(TOKYO, 90, 300);
		expect(t.features[1].lon).toBeCloseTo(east.lon, 4);
		expect(t.features[1].triangles.length).toBe(10);
		expect(Math.min(...t.rel)).toBe(0);
	});
	it('stands them on the ground in a scene frame', () => {
		const raw = boxes(tile, TOKYO, [{ e: 0, n: 0, size: 20, height: 30 }]);
		const geo = buildingGeometry(decodeTile(raw, tile), () => 25, { origin: TOKYO });
		const y = geo.getAttribute('position');
		const ys = Array.from({ length: y.count }, (_, i) => y.getY(i));
		expect(Math.min(...ys)).toBeCloseTo(25, 1);
		expect(Math.max(...ys)).toBeCloseTo(55, 1);
	});
});

describe('obstruction', () => {
	const tile = tileAt(TOKYO.lon, TOKYO.lat, 14);
	// Fuji from central Tokyo: bearing about 250°, summit about 1.4° up.
	const eye = { ...TOKYO, elevation: 10 + 1.6 };
	const wall = (dist: number, height: number) => {
		const p = destination(TOKYO, 250, dist);
		// Offsets east/north of the anchor, as the tile would carry them.
		const k = (Math.PI / 180) * 6378137;
		return {
			e: (p.lon - TOKYO.lon) * k * Math.cos((TOKYO.lat * Math.PI) / 180),
			n: (p.lat - TOKYO.lat) * k,
			size: 40,
			height
		};
	};
	it('finds a tall building on the line and ignores a low one', () => {
		const t = decodeTile(boxes(tile, TOKYO, [wall(500, 40), wall(900, 5)]), tile);
		const hit = obstruction([t], eye, 250, 1.4, flat);
		expect(hit).not.toBeNull();
		expect(hit!.distance).toBeCloseTo(480, -2);
		expect(hit!.top).toBe(50);
		const low = decodeTile(boxes(tile, TOKYO, [wall(900, 5)]), tile);
		expect(obstruction([low], eye, 250, 1.4, flat)).toBeNull();
	});
	it('lets the line pass over a building the ray has climbed above', () => {
		// At 2 km the line is 49 m up; a 30 m building (top at 40 m) is under it.
		const t = decodeTile(boxes(tile, TOKYO, [wall(2_000, 30)]), tile);
		expect(obstruction([t], eye, 250, 1.4, flat)).toBeNull();
		const taller = decodeTile(boxes(tile, TOKYO, [wall(2_000, 60)]), tile);
		expect(obstruction([taller], eye, 250, 1.4, flat)).not.toBeNull();
	});
	it('misses a building off to the side', () => {
		const p = destination(destination(TOKYO, 250, 500), 340, 60);
		const k = (Math.PI / 180) * 6378137;
		const side = {
			e: (p.lon - TOKYO.lon) * k * Math.cos((TOKYO.lat * Math.PI) / 180),
			n: (p.lat - TOKYO.lat) * k,
			size: 20,
			height: 80
		};
		const t = decodeTile(boxes(tile, TOKYO, [side]), tile);
		expect(obstruction([t], eye, 250, 1.4, flat)).toBeNull();
	});
});
