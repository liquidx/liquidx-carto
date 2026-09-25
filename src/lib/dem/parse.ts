import type { DemTile } from './types.js';

const NODATA = -9999;

function textBetween(src: string, open: string, close: string, from = 0): string | null {
	const a = src.indexOf(open, from);
	if (a < 0) return null;
	const b = src.indexOf(close, a + open.length);
	if (b < 0) return null;
	return src.slice(a + open.length, b);
}

function tag(src: string, name: string, from = 0): string | null {
	const v = textBetween(src, `<${name}>`, `</${name}>`, from);
	return v === null ? null : v.trim();
}

/**
 * Parse a GSI 基盤地図情報 (FGD) DEM GML file.
 * Handles `startPoint` offsets, `-9999` nodata and short tuple lists.
 */
export function parseFgdDem(xml: string, name: string): DemTile {
	const head = xml.slice(0, Math.min(xml.length, 8000));
	const lower = tag(head, 'gml:lowerCorner');
	const upper = tag(head, 'gml:upperCorner');
	const high = tag(head, 'gml:high');
	const low = tag(head, 'gml:low') ?? '0 0';
	if (!lower || !upper || !high) throw new Error(`${name}: missing envelope/grid`);

	const [south, west] = lower.split(/\s+/).map(Number);
	const [north, east] = upper.split(/\s+/).map(Number);
	const [lowX, lowY] = low.split(/\s+/).map(Number);
	const [highX, highY] = high.split(/\s+/).map(Number);
	const width = highX - lowX + 1;
	const height = highY - lowY + 1;

	const mesh = tag(head, 'mesh') ?? name;

	// sequenceRule / startPoint live after the tuple list (end of file).
	const tail = xml.slice(Math.max(0, xml.length - 2000));
	const startPoint = (tag(tail, 'gml:startPoint') ?? '0 0').split(/\s+/).map(Number);
	const order = textBetween(tail, 'order="', '"') ?? '+x-y';
	if (order !== '+x-y') {
		// Only the standard GSI ordering is supported; other orders are rare.
		console.warn(`${name}: unexpected sequence order ${order}`);
	}

	const data = new Float32Array(width * height).fill(NaN);
	const listStart = xml.indexOf('<gml:tupleList>');
	const listEnd = xml.indexOf('</gml:tupleList>', listStart);
	if (listStart < 0 || listEnd < 0) throw new Error(`${name}: missing tupleList`);

	let idx = startPoint[1] * width + startPoint[0];
	let pos = listStart + '<gml:tupleList>'.length;
	let minZ = Infinity;
	let maxZ = -Infinity;
	const total = width * height;
	while (pos < listEnd && idx < total) {
		const nl = xml.indexOf('\n', pos);
		const lineEnd = nl < 0 || nl > listEnd ? listEnd : nl;
		const comma = xml.indexOf(',', pos);
		if (comma > 0 && comma < lineEnd) {
			const z = parseFloat(xml.slice(comma + 1, lineEnd));
			if (z !== NODATA && !Number.isNaN(z)) {
				data[idx] = z;
				if (z < minZ) minZ = z;
				if (z > maxZ) maxZ = z;
			}
			idx++;
		} else if (lineEnd > pos && xml.slice(pos, lineEnd).trim().length > 0) {
			// Malformed line: keep grid alignment.
			idx++;
		}
		pos = lineEnd + 1;
	}

	return {
		id: mesh,
		name,
		west,
		south,
		east,
		north,
		width,
		height,
		data,
		minZ: Number.isFinite(minZ) ? minZ : 0,
		maxZ: Number.isFinite(maxZ) ? maxZ : 0
	};
}
