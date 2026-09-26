import { describe, expect, it } from 'vitest';
import { decodeCoastline } from './coast';
import { haversine, insideRing } from './geo';
import { distanceGrid } from './grid';
import { parseChargersKml, toCompactRows, toCsv } from './kml';
import { analyseRoute } from './routes';

const KML = `<kml><Document>
<Placemark>
	<name>札幌日産自動車（株）  中央店</name>
	<description><![CDATA[・住所：札幌市中央区大通東2丁目3-3<br>・営業時間：24h<br>・充電種別：200V,急速充電<br>・その他：TEEMOカードが必要 <br>急速充電：1回30分 <br>eMP提携充電器]]></description>
	<Point><coordinates>
		141.3595001,43.0628,0
	</coordinates></Point>
</Placemark>
<Placemark>
	<name>No point</name>
	<description>・充電種別：100V</description>
</Placemark>
</Document></kml>`;

describe('parseChargersKml', () => {
	it('reads fields and derives flags', () => {
		const [f, ...rest] = parseChargersKml(KML);
		expect(rest).toHaveLength(0);
		expect(f.geometry.coordinates).toEqual([141.3595, 43.0628]);
		expect(f.properties).toMatchObject({
			name: '札幌日産自動車（株） 中央店',
			address: '札幌市中央区大通東2丁目3-3',
			tel: null,
			hours: '24h',
			dc_fast: true,
			ac200: true,
			ac100: false,
			open_24h: true,
			emp_network: true,
			card_or_app_required: true,
			notes: 'TEEMOカードが必要 / 急速充電：1回30分 / eMP提携充電器'
		});
	});

	it('packs compact rows and csv', () => {
		const features = parseChargersKml(KML);
		expect(toCompactRows(features)[0].slice(0, 5)).toEqual([
			141.3595,
			43.0628,
			features[0].properties.name,
			3,
			7
		]);
		const csv = toCsv(features);
		expect(csv.startsWith('\uFEFFlon,lat,name,')).toBe(true);
		expect(csv).toContain('"200V,急速充電"');
	});
});

describe('decodeCoastline', () => {
	it('undoes the delta encoding and closes rings', () => {
		const [a, b] = decodeCoastline('140000 42000 1000 0 0 1000|141000 43000 5 5');
		expect(a).toEqual([
			[140, 42],
			[141, 42],
			[141, 43],
			[140, 42]
		]);
		expect(b).toEqual([
			[141, 43],
			[141.005, 43.005],
			[141, 43]
		]);
	});
});

describe('geo', () => {
	it('measures a degree of latitude', () => {
		expect(haversine(141, 43, 141, 44)).toBeCloseTo(111.2, 1);
	});
	it('ray casts', () => {
		const sq: [number, number][] = [
			[0, 0],
			[2, 0],
			[2, 2],
			[0, 2],
			[0, 0]
		];
		expect(insideRing(1, 1, sq)).toBe(true);
		expect(insideRing(3, 1, sq)).toBe(false);
	});
});

describe('distanceGrid', () => {
	it('masks land and measures to the nearest site', () => {
		const land: [number, number][] = [
			[141, 43],
			[141.2, 43],
			[141.2, 43.2],
			[141, 43.2],
			[141, 43]
		];
		const g = distanceGrid([land], [{ lon: 141.1, lat: 43.1, open24h: false }]);
		const mask = g.mask.split('').filter((c) => c === '1').length;
		expect(mask).toBeGreaterThan(0);
		const d = g.dAll.split(',').map(Number);
		const d24 = g.d24.split(',').map(Number);
		const land1 = [...g.mask].flatMap((c, i) => (c === '1' ? [i] : []));
		expect(Math.min(...land1.map((i) => d[i]))).toBeLessThanOrEqual(3);
		// No 24h site at all: every land cell hits the cap.
		expect(land1.every((i) => d24[i] === 120)).toBe(true);
	});
});

describe('analyseRoute', () => {
	// A 1° run due east at 43.5°n, about 80.7 km.
	const wp: [number, number][] = [
		[141, 43.5],
		[142, 43.5]
	];

	it('finds the longest gap between chargers in the corridor', () => {
		const r = analyseRoute('test', wp, [
			{ lon: 141.25, lat: 43.5, name: 'a', open24h: true },
			{ lon: 141.5, lat: 43.52, name: 'b', open24h: false },
			// 30 km off the line: ignored.
			{ lon: 141.75, lat: 43.8, name: 'far', open24h: true }
		]);
		expect(r.km).toBe(81);
		expect(r.n).toBe(2);
		expect(r.after).toBe('b');
		expect(r.gap).toBe(40);
		expect(r.n24).toBe(1);
		expect(r.after24).toBe('a');
		// a at ~20.2 km, then nothing until the end at ~80.7 km.
		expect(r.gap24).toBe(60);
	});

	it('reports the whole route when nothing is on it', () => {
		const r = analyseRoute('empty', wp, []);
		expect(r.gap).toBe(r.km);
		expect(r.after).toBe('(none on route)');
	});
});
