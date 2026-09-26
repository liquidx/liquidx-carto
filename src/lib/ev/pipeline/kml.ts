/**
 * Parse the KML export of 北海道のEV・PHV充電器マップ (a Google My Map) into charger features.
 * Each placemark's description is a CDATA run of `・label：value<br>` fields.
 */
import type { Feature, FeatureCollection, Point } from 'geojson';
import {
	CARD_REQUIRED,
	EMP_NETWORK,
	OPEN_24H,
	TESLA,
	TYPE_AC100,
	TYPE_AC200,
	TYPE_DC,
	type ChargerRow
} from '../model.ts';
import { round } from './geo.ts';

export interface ChargerProperties {
	name: string;
	/** Raw 充電種別, e.g. "200V,急速充電". */
	charge_type: string;
	dc_fast: boolean;
	ac200: boolean;
	ac100: boolean;
	address: string | null;
	tel: string | null;
	hours: string;
	closed: string | null;
	open_24h: boolean;
	emp_network: boolean;
	tesla: boolean;
	card_or_app_required: boolean;
	notes: string | null;
}

export type ChargerFeature = Feature<Point, ChargerProperties>;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
	s
		.replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, '$1')
		.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e]);

const tag = (block: string, name: string) =>
	decode(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '');

/** One `・label：value` field, `<br>` joined with " / " and whitespace collapsed. */
function field(desc: string, label: string): string | null {
	const m = desc.match(new RegExp(`・${label}：([\\s\\S]*?)(?=<br>・|$)`));
	if (!m) return null;
	const v = m[1]
		.replace(/<br>/g, ' / ')
		.replace(/\s+/g, ' ')
		.replace(/^[ /]+|[ /]+$/g, '')
		.trim();
	return v || null;
}

export function parseChargersKml(kml: string): ChargerFeature[] {
	const out: ChargerFeature[] = [];
	for (const [, block] of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
		const coords = block.match(/<coordinates>\s*([^<]+?)\s*<\/coordinates>/)?.[1];
		if (!coords) continue;
		const [lon, lat] = coords.split(',').map(Number);
		const name = tag(block, 'name').replace(/\s+/g, ' ').trim();
		const desc = tag(block, 'description');
		const kind = field(desc, '充電種別') ?? '';
		const notes = field(desc, 'その他') ?? '';
		const hours = field(desc, '営業時間') ?? '';
		out.push({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [round(lon, 6), round(lat, 6)] },
			properties: {
				name,
				charge_type: kind,
				dc_fast: kind.includes('急速'),
				ac200: kind.includes('200V'),
				ac100: kind.includes('100V'),
				address: field(desc, '住所'),
				tel: field(desc, '電話番号'),
				hours,
				closed: field(desc, '休日'),
				open_24h: /24\s*h|24時間/i.test(hours),
				emp_network: /eMP/i.test(desc),
				tesla: /テスラ|スーパーチャージャー|Tesla/i.test(`${kind} ${notes} ${name}`),
				card_or_app_required: /カード|アプリ|会員|登録|QR/.test(notes),
				notes: notes || null
			}
		});
	}
	return out;
}

export function featureCollection(
	features: ChargerFeature[],
	name: string
): FeatureCollection<Point, ChargerProperties> & { name: string; metadata: object } {
	return {
		type: 'FeatureCollection',
		name,
		metadata: {
			source: '北海道のEV・PHV充電器マップ / 一般社団法人北海道開発技術センター (dec)',
			source_url: 'https://decnet.or.jp/hokkaido_evphv',
			data_current_as_of: '2026-06-01',
			extracted: '2026-08-28',
			count: features.length
		},
		features
	};
}

const CSV_KEYS: (keyof ChargerProperties)[] = [
	'name',
	'charge_type',
	'dc_fast',
	'ac200',
	'ac100',
	'address',
	'tel',
	'hours',
	'closed',
	'open_24h',
	'emp_network',
	'tesla',
	'card_or_app_required',
	'notes'
];

/** Flat CSV with a BOM, so spreadsheet apps read the Japanese text as UTF-8. */
export function toCsv(features: ChargerFeature[]): string {
	const cell = (v: unknown) => {
		const s = v == null ? '' : String(v);
		return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const lines = [['lon', 'lat', ...CSV_KEYS].join(',')];
	for (const f of features)
		lines.push(
			[...f.geometry.coordinates, ...CSV_KEYS.map((k) => f.properties[k])].map(cell).join(',')
		);
	return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** The positional row form the page loads: see `ChargerRow` in ../model.ts. */
export function toCompactRows(features: ChargerFeature[]): ChargerRow[] {
	return features.map(({ geometry, properties: p }) => {
		const [lon, lat] = geometry.coordinates;
		const type =
			(p.dc_fast ? TYPE_DC : 0) | (p.ac200 ? TYPE_AC200 : 0) | (p.ac100 ? TYPE_AC100 : 0);
		const status =
			(p.open_24h ? OPEN_24H : 0) |
			(p.card_or_app_required ? CARD_REQUIRED : 0) |
			(p.emp_network ? EMP_NETWORK : 0) |
			(p.tesla ? TESLA : 0);
		// Notes are long; the popup only needs the gist. Slice by code point, not UTF-16 unit.
		const notes = Array.from(p.notes ?? '')
			.slice(0, 110)
			.join('');
		return [round(lon, 4), round(lat, 4), p.name, type, status, p.hours, p.address ?? '', notes];
	});
}
