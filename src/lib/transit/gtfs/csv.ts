/**
 * Minimal RFC 4180 CSV parser for GTFS tables.
 * Handles a UTF-8 BOM, CRLF/LF line endings, quoted fields and escaped quotes.
 * Returns one object per row keyed by the header names.
 */
export function parseCsv(text: string): Record<string, string>[] {
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	const rows = parseCsvRows(text);
	if (rows.length === 0) return [];
	const header = rows[0].map((h) => h.trim());
	const out: Record<string, string>[] = [];
	for (let r = 1; r < rows.length; r++) {
		const row = rows[r];
		if (row.length === 1 && row[0] === '') continue;
		const obj: Record<string, string> = {};
		for (let c = 0; c < header.length; c++) obj[header[c]] = row[c] ?? '';
		out.push(obj);
	}
	return out;
}

export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let i = 0;
	let quoted = false;
	const n = text.length;
	while (i < n) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}
		if (ch === '"') {
			quoted = true;
			i++;
		} else if (ch === ',') {
			row.push(field);
			field = '';
			i++;
		} else if (ch === '\n' || ch === '\r') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
		} else {
			// Fast path: consume a run of plain characters.
			let j = i + 1;
			while (j < n) {
				const c = text[j];
				if (c === ',' || c === '\n' || c === '\r' || c === '"') break;
				j++;
			}
			field += text.slice(i, j);
			i = j;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}
