/**
 * How a dataset is served by ODPT:
 * - public:    api-public.odpt.org, no token (CC BY 4.0 data)
 * - basic:     api.odpt.org, needs a developer-site access token (公共交通オープンデータ基本ライセンス)
 * - challenge: api-challenge.odpt.org, needs an Open Data Challenge token; usable during the contest only
 */
export type OdptAccess = 'public' | 'basic' | 'challenge';

export type OdptGtfsFeed = {
	id: string;
	/** ODPT operator id, as used in `odpt.Operator:<operator>`. */
	operator: string;
	name: string;
	access: OdptAccess;
	/** Path under /api/v4/files/ */
	path: string;
	/** Dataset page on ckan.odpt.org */
	dataset: string;
	license: string;
};

const BASIC = '公共交通オープンデータ基本ライセンス';
const CHALLENGE = 'Open Data Challenge 2026 limited';

/**
 * Rail GTFS feeds published on ckan.odpt.org (September 2026).
 * Bus feeds and other datasets can be fetched by passing a path/URL directly.
 */
export const odptGtfsFeeds: OdptGtfsFeed[] = [
	{
		id: 'toei',
		operator: 'Toei',
		name: 'Toei Subway, Sakura Tram, Nippori-Toneri Liner',
		access: 'public',
		path: 'Toei/data/Toei-Train-GTFS.zip',
		dataset: 'train-toei',
		license: 'CC BY 4.0'
	},
	{
		id: 'tokyometro',
		operator: 'TokyoMetro',
		name: 'Tokyo Metro',
		access: 'basic',
		path: 'TokyoMetro/data/TokyoMetro-Train-GTFS.zip',
		dataset: 'train-tokyometro',
		license: BASIC
	},
	{
		id: 'mir',
		operator: 'MIR',
		name: 'Tsukuba Express',
		access: 'basic',
		path: 'MIR/data/MIR-Train-GTFS.zip',
		dataset: 'train-mir',
		license: BASIC
	},
	{
		id: 'twr',
		operator: 'TWR',
		name: 'Rinkai Line',
		access: 'basic',
		path: 'TWR/data/TWR-Train-GTFS.zip',
		dataset: 'train-twr',
		license: BASIC
	},
	{
		id: 'tamamonorail',
		operator: 'TamaMonorail',
		name: 'Tama Monorail',
		access: 'basic',
		path: 'TamaMonorail/data/TamaMonorail-Train-GTFS.zip',
		dataset: 'train-tamamonorail',
		license: BASIC
	},
	{
		id: 'yokohama',
		operator: 'YokohamaMunicipal',
		name: 'Yokohama Municipal Subway',
		access: 'basic',
		path: 'odpt/YokohamaMunicipal/Train.zip',
		dataset: 'yokohama_municipal_train',
		license: BASIC
	},
	{
		id: 'keio',
		operator: 'Keio',
		name: 'Keio Line, Inokashira Line',
		access: 'challenge',
		path: 'Keio/data/Keio-Train-GTFS.zip',
		dataset: 'keio_train',
		license: CHALLENGE
	},
	{
		id: 'jreast',
		operator: 'JR-East',
		name: 'JR East (Tokyo area)',
		access: 'challenge',
		path: 'JR-East/data/JR-East-Train-GTFS.zip',
		dataset: 'jreast_tokyo_area',
		license: CHALLENGE
	},
	{
		id: 'tobu',
		operator: 'Tobu',
		name: 'Tobu Railway',
		access: 'challenge',
		path: 'Tobu/data/Tobu-Train-GTFS.zip',
		dataset: 'tobu_train',
		license: CHALLENGE
	},
	{
		id: 'sotetsu',
		operator: 'Sotetsu',
		name: 'Sotetsu',
		access: 'challenge',
		path: 'Sotetsu/data/Sotetsu-Train-GTFS.zip',
		dataset: 'sotetsu_train',
		license: CHALLENGE
	}
];

export function findOdptFeed(id: string): OdptGtfsFeed | undefined {
	return odptGtfsFeeds.find((f) => f.id === id);
}
