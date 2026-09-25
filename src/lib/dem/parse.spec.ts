import { describe, it, expect } from 'vitest';
import { parseFgdDem } from './parse.js';

function fixture(values: string[], startPoint = '0 0') {
	return `<?xml version="1.0"?>
<Dataset><DEM><mesh>1234</mesh><coverage>
<gml:boundedBy><gml:Envelope>
<gml:lowerCorner>36.25 137.625</gml:lowerCorner>
<gml:upperCorner>36.26 137.64</gml:upperCorner>
</gml:Envelope></gml:boundedBy>
<gml:GridEnvelope><gml:low>0 0</gml:low><gml:high>2 1</gml:high></gml:GridEnvelope>
<gml:tupleList>
${values.join('\n')}
</gml:tupleList>
<gml:sequenceRule order="+x-y">Linear</gml:sequenceRule>
<gml:startPoint>${startPoint}</gml:startPoint>
</coverage></DEM></Dataset>`;
}

describe('parseFgdDem', () => {
	it('parses a 3x2 grid row-major from the north-west', () => {
		const t = parseFgdDem(
			fixture(['地表面,1', '地表面,2', '地表面,3', '地表面,4', '地表面,5', '地表面,6']),
			'a.xml'
		);
		expect(t.width).toBe(3);
		expect(t.height).toBe(2);
		expect([...t.data]).toEqual([1, 2, 3, 4, 5, 6]);
		expect(t.west).toBe(137.625);
		expect(t.north).toBe(36.26);
		expect(t.minZ).toBe(1);
		expect(t.maxZ).toBe(6);
	});

	it('honours startPoint and treats -9999 as nodata', () => {
		const t = parseFgdDem(fixture(['地表面,10', '内水面,-9999', '地表面,12'], '1 0'), 'b.xml');
		const d = [...t.data];
		expect(d[0]).toBeNaN();
		expect(d[1]).toBe(10);
		expect(d[2]).toBeNaN();
		expect(d[3]).toBe(12);
		expect(d[4]).toBeNaN();
		expect(t.minZ).toBe(10);
	});
});
