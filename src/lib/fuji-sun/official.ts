/**
 * Diamond fuji spots from the kanto regional development bureau (国土交通省 関東地方整備局),
 * chosen from its hundred views of fuji (関東の富士見百景), with the days it gives for each.
 * The bureau simulated them in kashmir 3d with the sun's centre on the middle of the summit,
 * from positions it set by eye where no address was to hand; the dates are a guide, a day or
 * two either way with leap years.
 *
 * Positions here are geocoded from the names (google maps, then checked by hand), so they are
 * no better than the bureau's own: `approx` marks those that only resolved to a district.
 * `ground` is the height of the ground there from gsi, in metres.
 */
import type { Phase } from './sun';

export const OFFICIAL_SOURCE = 'https://www.ktr.mlit.go.jp/chiiki/chiiki00000111.html';
/** The bureau's page on what counts as diamond fuji. */
export const OFFICIAL_DEFINITION = 'https://www.ktr.mlit.go.jp/chiiki/chiiki00000112.html';

export interface OfficialSpot {
	id: string;
	/** The bureau's number for the view, shared by the places listed under it. */
	num: number;
	name: string;
	lon: number;
	lat: number;
	ground: number;
	/** Metres above the ground: a deck, or just eye height. */
	eye: number;
	phase: Phase;
	/** The published days, as [month, day, to month, to day]; one or two a year. */
	dates: [number, number, number, number][];
	approx: boolean;
	url: string;
}

export const OFFICIAL: OfficialSpot[] = [
	{
		id: 'ktr-5-1',
		num: 5,
		name: '権現山公園',
		lon: 140.51409,
		lat: 35.96088,
		ground: 27,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 30, 1, 31],
			[11, 11, 11, 11]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0005.html'
	},
	{
		id: 'ktr-36-1',
		num: 36,
		name: 'ふなばし三番瀬海浜公園とその周辺',
		lon: 139.96696,
		lat: 35.67258,
		ground: 4,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 14, 2, 15],
			[10, 27, 10, 27]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0036.html'
	},
	{
		id: 'ktr-37-1',
		num: 37,
		name: '北条海岸',
		lon: 139.85908,
		lat: 35.00212,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[5, 13, 5, 14],
			[7, 29, 7, 30]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0037.html'
	},
	{
		id: 'ktr-37-2',
		num: 37,
		name: '城山公園',
		lon: 139.85555,
		lat: 34.98149,
		ground: 65,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[5, 16, 5, 17],
			[7, 27, 7, 27]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0037.html'
	},
	{
		id: 'ktr-37-3',
		num: 37,
		name: '伊戸',
		lon: 139.77543,
		lat: 34.95901,
		ground: 58,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[5, 29, 5, 30],
			[7, 13, 7, 14]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0037.html'
	},
	{
		id: 'ktr-38-1',
		num: 38,
		name: '金田さざなみ公園２号近隣公園）',
		lon: 139.93198,
		lat: 35.44129,
		ground: 4,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 14, 3, 14],
			[9, 29, 9, 29]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0038.html'
	},
	{
		id: 'ktr-38-2',
		num: 38,
		name: 'きみさらづタワー（太田山公園）',
		lon: 139.93769,
		lat: 35.37966,
		ground: 46,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 20, 3, 20],
			[9, 22, 9, 22]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0038.html'
	},
	{
		id: 'ktr-39-1',
		num: 39,
		name: '戸定が丘歴史公園内戸定邸',
		lon: 139.89893,
		lat: 35.77765,
		ground: 26,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 29, 1, 29],
			[11, 12, 11, 13]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0039.html'
	},
	{
		id: 'ktr-40-1',
		num: 40,
		name: '玉葉橋（ぎょくようばし）',
		lon: 139.87365,
		lat: 35.91445,
		ground: 5,
		eye: 1.6,
		phase: 'sunset',
		dates: [[12, 20, 12, 22]],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0040.html'
	},
	{
		id: 'ktr-41-1',
		num: 41,
		name: 'すいごうさわら',
		lon: 140.5248,
		lat: 35.9298,
		ground: 0,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 3, 2, 4],
			[11, 7, 11, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0041.html'
	},
	{
		id: 'ktr-42-1',
		num: 42,
		name: '上永井公園',
		lon: 140.73977,
		lat: 35.69364,
		ground: 64,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 25, 2, 26],
			[10, 15, 10, 16]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0042.html'
	},
	{
		id: 'ktr-43-1',
		num: 43,
		name: '茜浜緑道',
		lon: 140.01345,
		lat: 35.66408,
		ground: 5,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 17, 2, 17],
			[10, 24, 10, 25]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0043.html'
	},
	{
		id: 'ktr-44-1',
		num: 44,
		name: '柏市立富勢中学校前市道',
		lon: 139.9854,
		lat: 35.88465,
		ground: 19,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 17, 1, 17],
			[11, 24, 11, 25]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0044.html'
	},
	{
		id: 'ktr-45-1',
		num: 45,
		name: '旧村川別荘周辺の斜面緑地',
		lon: 140.0248,
		lat: 35.86592,
		ground: 13,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 23, 1, 24],
			[11, 18, 11, 19]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0045.html'
	},
	{
		id: 'ktr-45-2',
		num: 45,
		name: '古利根沼',
		lon: 140.07558,
		lat: 35.87697,
		ground: 7,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 23, 1, 24],
			[11, 18, 11, 19]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0045.html'
	},
	{
		id: 'ktr-46-1',
		num: 46,
		name: '天富神社境内地展望台',
		lon: 140.14999,
		lat: 35.15949,
		ground: 334,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 12, 4, 13],
			[8, 30, 8, 31]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0046.html'
	},
	{
		id: 'ktr-47-1',
		num: 47,
		name: '千葉県立富津公園',
		lon: 139.79681,
		lat: 35.31217,
		ground: 1,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 30, 3, 31],
			[9, 12, 9, 13]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0047.html'
	},
	{
		id: 'ktr-47-2',
		num: 47,
		name: '東京湾観音',
		lon: 139.86246,
		lat: 35.2634,
		ground: 126,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 4, 4, 5],
			[9, 7, 9, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0047.html'
	},
	{
		id: 'ktr-47-3',
		num: 47,
		name: '鋸山',
		lon: 139.84077,
		lat: 35.1603,
		ground: 323,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 18, 4, 19],
			[8, 23, 8, 24]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0047.html'
	},
	{
		id: 'ktr-48-1',
		num: 48,
		name: '千葉県富浦町原岡海岸',
		lon: 139.84065,
		lat: 35.04622,
		ground: 13,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[5, 6, 5, 7],
			[8, 5, 8, 6]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0048.html'
	},
	{
		id: 'ktr-48-2',
		num: 48,
		name: '自然公園大房岬',
		lon: 139.81275,
		lat: 35.03895,
		ground: 60,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[5, 8, 5, 8],
			[8, 4, 8, 5]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0048.html'
	},
	{
		id: 'ktr-49-1',
		num: 49,
		name: '岩井海岸',
		lon: 139.8404,
		lat: 35.09409,
		ground: 1,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 29, 4, 30],
			[8, 12, 8, 13]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0049.html'
	},
	{
		id: 'ktr-50-1',
		num: 50,
		name: '元名海岸（もとな）',
		lon: 139.83124,
		lat: 35.14771,
		ground: 6,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 21, 4, 22],
			[8, 21, 8, 22]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0050.html'
	},
	{
		id: 'ktr-50-2',
		num: 50,
		name: '鱚ヶ浦海岸（きすがうら）',
		lon: 139.83618,
		lat: 35.12536,
		ground: 1,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 24, 4, 25],
			[8, 18, 8, 19]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0050.html'
	},
	{
		id: 'ktr-51-1',
		num: 51,
		name: '川口市荒川運動公園',
		lon: 139.71446,
		lat: 35.79374,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 13, 1, 14],
			[11, 28, 11, 29]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0051.html'
	},
	{
		id: 'ktr-51-2',
		num: 51,
		name: '荒川下流(戸田橋)',
		lon: 139.68446,
		lat: 35.80015,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 8, 1, 9],
			[11, 29, 11, 30]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0051.html'
	},
	{
		id: 'ktr-51-3',
		num: 51,
		name: '足立区都市農業公園',
		lon: 139.74494,
		lat: 35.7822,
		ground: 5,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 19, 1, 20],
			[11, 22, 11, 23]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0051.html'
	},
	{
		id: 'ktr-51-4',
		num: 51,
		name: '小菅西公園',
		lon: 139.81895,
		lat: 35.75252,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 29, 1, 30],
			[11, 12, 11, 13]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0051.html'
	},
	{
		id: 'ktr-52-1',
		num: 52,
		name: '文京シビックセンター展望ラウンジ',
		lon: 139.75279,
		lat: 35.70798,
		ground: 7,
		eye: 105,
		phase: 'sunset',
		dates: [
			[2, 1, 2, 2],
			[11, 9, 11, 10]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0052.html'
	},
	{
		id: 'ktr-53-1',
		num: 53,
		name: '目黒駅周辺',
		lon: 139.70773,
		lat: 35.63388,
		ground: 8,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 11, 2, 12],
			[10, 30, 10, 31]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0053.html'
	},
	{
		id: 'ktr-53-2',
		num: 53,
		name: '青葉台地区',
		lon: 139.69433,
		lat: 35.65088,
		ground: 28,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 8, 2, 8],
			[11, 2, 11, 3]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0053.html'
	},
	{
		id: 'ktr-53-3',
		num: 53,
		name: '大岡山地区',
		lon: 139.6822,
		lat: 35.60985,
		ground: 32,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 14, 2, 15],
			[10, 27, 10, 28]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0053.html'
	},
	{
		id: 'ktr-53-4',
		num: 53,
		name: '田園調布周辺',
		lon: 139.66817,
		lat: 35.59388,
		ground: 16,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 17, 2, 18],
			[10, 24, 10, 25]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0053.html'
	},
	{
		id: 'ktr-53-5',
		num: 53,
		name: '瀬田・岡本地区',
		lon: 139.61843,
		lat: 35.62551,
		ground: 36,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 9, 2, 10],
			[11, 1, 11, 2]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0053.html'
	},
	{
		id: 'ktr-53-6',
		num: 53,
		name: '善福寺地区',
		lon: 139.59295,
		lat: 35.71382,
		ground: 47,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 22, 1, 22],
			[11, 19, 11, 20]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0053.html'
	},
	{
		id: 'ktr-53-7',
		num: 53,
		name: '日暮里富士見坂',
		lon: 139.7667,
		lat: 35.7297,
		ground: 13,
		eye: 1.6,
		phase: 'sunset',
		dates: [],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0053.html'
	},
	{
		id: 'ktr-54-1',
		num: 54,
		name: '富士見橋',
		lon: 139.63577,
		lat: 35.6127,
		ground: 26,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 12, 2, 12],
			[10, 30, 10, 30]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0054.html'
	},
	{
		id: 'ktr-54-2',
		num: 54,
		name: '成城の富士見橋、不動橋',
		lon: 139.59363,
		lat: 35.63855,
		ground: 41,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 5, 2, 6],
			[11, 5, 11, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0054.html'
	},
	{
		id: 'ktr-55-1',
		num: 55,
		name: '高尾山山頂',
		lon: 139.2437,
		lat: 35.6252,
		ground: 598,
		eye: 1.6,
		phase: 'sunset',
		dates: [[12, 17, 12, 26]],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0055.html'
	},
	{
		id: 'ktr-56-1',
		num: 56,
		name: '八王子市立栃谷戸公園',
		lon: 139.31822,
		lat: 35.62902,
		ground: 159,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 13, 1, 14],
			[11, 28, 11, 29]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0056.html'
	},
	{
		id: 'ktr-57-1',
		num: 57,
		name: '多摩川緑地',
		lon: 139.39818,
		lat: 35.68825,
		ground: 72,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 7, 1, 8],
			[12, 14, 12, 15]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0057.html'
	},
	{
		id: 'ktr-59-1',
		num: 59,
		name: '都立浅間山公園からの富士',
		lon: 139.49894,
		lat: 35.68086,
		ground: 52,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 21, 1, 21],
			[11, 21, 11, 21]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0059.html'
	},
	{
		id: 'ktr-60-1',
		num: 60,
		name: '都立小山田緑地本園みはらし広場',
		lon: 139.4144,
		lat: 35.59582,
		ground: 121,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 3, 2, 4],
			[11, 7, 11, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0060.html'
	},
	{
		id: 'ktr-61-1',
		num: 61,
		name: '光町もみじ公園',
		lon: 139.44539,
		lat: 35.70592,
		ground: 87,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 5, 1, 6],
			[12, 6, 12, 7]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0061.html'
	},
	{
		id: 'ktr-62-1',
		num: 62,
		name: '円形公園',
		lon: 139.44701,
		lat: 35.69867,
		ground: 75,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 9, 1, 9],
			[12, 3, 12, 4]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0062.html'
	},
	{
		id: 'ktr-68-1',
		num: 68,
		name: '鶴見川多目的遊水地（新横浜・ゆめオアシス）周辺',
		lon: 139.60043,
		lat: 35.51509,
		ground: 1,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 26, 2, 27],
			[10, 14, 10, 15]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0068.html'
	},
	{
		id: 'ktr-68-2',
		num: 68,
		name: '鷹野大橋及び鷹野橋人道橋',
		lon: 139.6534,
		lat: 35.53821,
		ground: 6,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 24, 2, 25],
			[10, 17, 10, 17]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0068.html'
	},
	{
		id: 'ktr-68-3',
		num: 68,
		name: '大黒大橋',
		lon: 139.67477,
		lat: 35.47148,
		ground: 2,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 7, 3, 8],
			[10, 5, 10, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0068.html'
	},
	{
		id: 'ktr-68-4',
		num: 68,
		name: '鶴見川河口から0.0Km地点',
		lon: 139.67624,
		lat: 35.49751,
		ground: 1,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 6, 3, 6],
			[10, 7, 10, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0068.html'
	},
	{
		id: 'ktr-68-5',
		num: 68,
		name: '鴨池橋',
		lon: 139.56704,
		lat: 35.5123,
		ground: 9,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 26, 2, 27],
			[10, 14, 10, 15]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0068.html'
	},
	{
		id: 'ktr-69-1',
		num: 69,
		name: '横浜港大さん橋国際客船ターミナル',
		lon: 139.64625,
		lat: 35.45017,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 9, 3, 10],
			[10, 3, 10, 4]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0069.html'
	},
	{
		id: 'ktr-70-1',
		num: 70,
		name: '松ノ内公園馬の背遊歩道',
		lon: 139.61021,
		lat: 35.38502,
		ground: 63,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 20, 3, 20],
			[9, 23, 9, 23]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0070.html'
	},
	{
		id: 'ktr-71-1',
		num: 71,
		name: '瀬上市民の森',
		lon: 139.58772,
		lat: 35.35975,
		ground: 46,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 23, 3, 24],
			[9, 19, 9, 19]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0071.html'
	},
	{
		id: 'ktr-72-1',
		num: 72,
		name: '横根稲荷神社付近',
		lon: 139.50012,
		lat: 35.42654,
		ground: 58,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 12, 3, 13],
			[9, 30, 10, 1]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0072.html'
	},
	{
		id: 'ktr-73-1',
		num: 73,
		name: '大楠山',
		lon: 139.62807,
		lat: 35.25005,
		ground: 240,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 11, 4, 11],
			[8, 31, 9, 1]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0073.html'
	},
	{
		id: 'ktr-74-1',
		num: 74,
		name: '横須賀市走水',
		lon: 139.72433,
		lat: 35.26206,
		ground: 24,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 6, 4, 7],
			[9, 5, 9, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0074.html'
	},
	{
		id: 'ktr-75-1',
		num: 75,
		name: '長井海の手公園「ソレイユの丘」',
		lon: 139.61194,
		lat: 35.19617,
		ground: 29,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 21, 4, 22],
			[8, 21, 8, 21]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0075.html'
	},
	{
		id: 'ktr-75-2',
		num: 75,
		name: '立石海岸',
		lon: 139.59795,
		lat: 35.24053,
		ground: 1,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 13, 4, 14],
			[8, 28, 8, 29]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0075.html'
	},
	{
		id: 'ktr-75-3',
		num: 75,
		name: '武山見晴台',
		lon: 139.65578,
		lat: 35.22,
		ground: 201,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 15, 4, 16],
			[8, 27, 8, 28]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0075.html'
	},
	{
		id: 'ktr-76-1',
		num: 76,
		name: '金目川と観音堂',
		lon: 139.28878,
		lat: 35.35872,
		ground: 25,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 27, 3, 28],
			[9, 15, 9, 16]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0076.html'
	},
	{
		id: 'ktr-76-2',
		num: 76,
		name: '七国峠・遠藤原',
		lon: 139.24899,
		lat: 35.33186,
		ground: 156,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 5, 4, 6],
			[9, 6, 9, 7]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0076.html'
	},
	{
		id: 'ktr-76-3',
		num: 76,
		name: '湘南平',
		lon: 139.30917,
		lat: 35.31997,
		ground: 179,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 4, 4, 5],
			[9, 7, 9, 7]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0076.html'
	},
	{
		id: 'ktr-76-4',
		num: 76,
		name: '平塚海岸',
		lon: 139.36259,
		lat: 35.31516,
		ground: 4,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 6, 4, 6],
			[9, 5, 9, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0076.html'
	},
	{
		id: 'ktr-76-5',
		num: 76,
		name: '馬入大橋周辺（湘南潮来）',
		lon: 139.36658,
		lat: 35.33563,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 2, 4, 2],
			[9, 9, 9, 10]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0076.html'
	},
	{
		id: 'ktr-76-6',
		num: 76,
		name: 'ひらつか花アグリ',
		lon: 139.3125,
		lat: 35.3588,
		ground: 11,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 26, 3, 27],
			[9, 16, 9, 16]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0076.html'
	},
	{
		id: 'ktr-76-7',
		num: 76,
		name: '湘南銀河大橋',
		lon: 139.37015,
		lat: 35.35359,
		ground: 5,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 27, 3, 28],
			[9, 15, 9, 16]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0076.html'
	},
	{
		id: 'ktr-77-1',
		num: 77,
		name: '鎌倉海浜公園稲村ガ崎地区',
		lon: 139.5248,
		lat: 35.30266,
		ground: 12,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 4, 4, 5],
			[9, 7, 9, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0077.html'
	},
	{
		id: 'ktr-77-2',
		num: 77,
		name: '浄明寺緑地',
		lon: 139.56794,
		lat: 35.31132,
		ground: 86,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 1, 4, 2],
			[9, 10, 9, 11]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0077.html'
	},
	{
		id: 'ktr-78-1',
		num: 78,
		name: '県立湘南海岸公園',
		lon: 139.47528,
		lat: 35.31373,
		ground: 8,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 3, 4, 4],
			[9, 8, 9, 9]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0078.html'
	},
	{
		id: 'ktr-79-1',
		num: 79,
		name: '国府津・曽我丘陵ウォーキングコース',
		lon: 139.20185,
		lat: 35.3087,
		ground: 222,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 18, 4, 19],
			[8, 23, 8, 24]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0079.html'
	},
	{
		id: 'ktr-79-2',
		num: 79,
		name: '栢山から見た富士（二宮尊徳の見た富士山）',
		lon: 139.14539,
		lat: 35.303,
		ground: 24,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 12, 4, 13],
			[8, 30, 8, 31]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0079.html'
	},
	{
		id: 'ktr-79-3',
		num: 79,
		name: '梅林と富士山',
		lon: 139.19309,
		lat: 35.29948,
		ground: 24,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 16, 4, 17],
			[8, 26, 8, 26]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0079.html'
	},
	{
		id: 'ktr-80-1',
		num: 80,
		name: '茅ヶ崎南湖の左富士',
		lon: 139.39324,
		lat: 35.3223,
		ground: 4,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 1, 4, 2],
			[9, 10, 9, 11]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0080.html'
	},
	{
		id: 'ktr-80-2',
		num: 80,
		name: '旧南湖院',
		lon: 139.38931,
		lat: 35.31952,
		ground: 4,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 4, 4, 5],
			[9, 7, 9, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0080.html'
	},
	{
		id: 'ktr-80-3',
		num: 80,
		name: '茅ヶ崎海岸・ヘッドランドとその周辺',
		lon: 139.4142,
		lat: 35.3152,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 4, 4, 4],
			[9, 7, 9, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0080.html'
	},
	{
		id: 'ktr-80-4',
		num: 80,
		name: '神奈川県立茅ヶ崎里山公園内・柳谷',
		lon: 139.41783,
		lat: 35.37673,
		ground: 27,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 22, 3, 23],
			[9, 20, 9, 21]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0080.html'
	},
	{
		id: 'ktr-81-1',
		num: 81,
		name: '披露山公園',
		lon: 139.56442,
		lat: 35.29644,
		ground: 92,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 4, 4, 5],
			[9, 7, 9, 7]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0081.html'
	},
	{
		id: 'ktr-81-2',
		num: 81,
		name: '大崎公園',
		lon: 139.55935,
		lat: 35.29378,
		ground: 76,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 5, 4, 6],
			[9, 5, 9, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0081.html'
	},
	{
		id: 'ktr-81-3',
		num: 81,
		name: '逗子海岸',
		lon: 139.57097,
		lat: 35.29368,
		ground: 2,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 5, 4, 6],
			[9, 5, 9, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0081.html'
	},
	{
		id: 'ktr-82-1',
		num: 82,
		name: 'ハイランド住宅内道路',
		lon: 139.57539,
		lat: 35.30964,
		ground: 38,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 31, 3, 31],
			[9, 11, 9, 12]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0082.html'
	},
	{
		id: 'ktr-83-1',
		num: 83,
		name: '弘法山公園展望台',
		lon: 139.24306,
		lat: 35.37192,
		ground: 243,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 24, 3, 24],
			[9, 18, 9, 18]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0083.html'
	},
	{
		id: 'ktr-84-1',
		num: 84,
		name: '県立はやま三ヶ岡山緑地',
		lon: 139.5781,
		lat: 35.26842,
		ground: 125,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 9, 4, 10],
			[9, 2, 9, 3]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0084.html'
	},
	{
		id: 'ktr-84-2',
		num: 84,
		name: '森戸神社',
		lon: 139.56968,
		lat: 35.27288,
		ground: 5,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 8, 4, 9],
			[9, 2, 9, 3]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0084.html'
	},
	{
		id: 'ktr-84-3',
		num: 84,
		name: '湘南国際村',
		lon: 139.61716,
		lat: 35.25605,
		ground: 160,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 10, 4, 11],
			[9, 1, 9, 2]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0084.html'
	},
	{
		id: 'ktr-84-4',
		num: 84,
		name: '葉山港',
		lon: 139.56755,
		lat: 35.2841,
		ground: 3,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 6, 4, 7],
			[9, 5, 9, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0084.html'
	},
	{
		id: 'ktr-85-1',
		num: 85,
		name: '二宮町の「吾妻山」',
		lon: 139.2501,
		lat: 35.29887,
		ground: 130,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 13, 4, 15],
			[9, 8, 9, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0085.html'
	},
	{
		id: 'ktr-86-1',
		num: 86,
		name: '県立大磯城山公園',
		lon: 139.29084,
		lat: 35.30444,
		ground: 32,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 10, 4, 10],
			[9, 1, 9, 2]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0086.html'
	},
	{
		id: 'ktr-86-2',
		num: 86,
		name: '大磯照ヶ崎海岸',
		lon: 139.31537,
		lat: 35.30578,
		ground: 2,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 9, 4, 10],
			[9, 2, 9, 3]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0086.html'
	},
	{
		id: 'ktr-87-1',
		num: 87,
		name: '中井中央公園とその周辺からの富士',
		lon: 139.2188,
		lat: 35.33882,
		ground: 100,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 3, 4, 3],
			[9, 8, 9, 9]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/chiiki00000114.html'
	},
	{
		id: 'ktr-88-1',
		num: 88,
		name: '大井町から見た富士',
		lon: 139.14203,
		lat: 35.32828,
		ground: 36,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[4, 9, 4, 10],
			[9, 2, 9, 3]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0088.html'
	},
	{
		id: 'ktr-89-1',
		num: 89,
		name: '西平畑公園（ハーブ館ほか）からの富士',
		lon: 139.13766,
		lat: 35.35214,
		ground: 175,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 31, 4, 1],
			[9, 10, 9, 11]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0089.html'
	},
	{
		id: 'ktr-90-1',
		num: 90,
		name: '大野山',
		lon: 139.04866,
		lat: 35.38616,
		ground: 723,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 18, 3, 19],
			[9, 24, 9, 25]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0090.html'
	},
	{
		id: 'ktr-90-2',
		num: 90,
		name: '丹沢湖畔千代の沢園地展望台',
		lon: 139.04771,
		lat: 35.41744,
		ground: 331,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[3, 5, 3, 6],
			[10, 7, 10, 8]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0090.html'
	},
	{
		id: 'ktr-96-1',
		num: 96,
		name: '女人天上（富士山遥拝所女人天上）吉田口登山道',
		lon: 138.76015,
		lat: 35.39779,
		ground: 1772,
		eye: 1.6,
		phase: 'sunset',
		dates: [[1, 7, 1, 10]],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0096.html'
	},
	{
		id: 'ktr-112-1',
		num: 112,
		name: '日出づる里（高下）',
		lon: 138.41733,
		lat: 35.53401,
		ground: 630,
		eye: 1.6,
		phase: 'sunrise',
		dates: [[12, 16, 1, 1]],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0112.html'
	},
	{
		id: 'ktr-113-1',
		num: 113,
		name: '林道富士見山線',
		lon: 138.38103,
		lat: 35.47047,
		ground: 1638,
		eye: 1.6,
		phase: 'sunrise',
		dates: [
			[1, 31, 1, 31],
			[11, 13, 11, 13]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0113.html'
	},
	{
		id: 'ktr-113-2',
		num: 113,
		name: '身延山',
		lon: 138.417,
		lat: 35.3973,
		ground: 1148,
		eye: 1.6,
		phase: 'sunrise',
		dates: [
			[3, 13, 3, 13],
			[10, 2, 10, 2]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0113.html'
	},
	{
		id: 'ktr-115-1',
		num: 115,
		name: '思親山',
		lon: 138.4906,
		lat: 35.29592,
		ground: 1023,
		eye: 1.6,
		phase: 'sunrise',
		dates: [
			[5, 18, 5, 18],
			[7, 25, 7, 26]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0115.html'
	},
	{
		id: 'ktr-115-2',
		num: 115,
		name: '佐野峠',
		lon: 138.48786,
		lat: 35.30551,
		ground: 834,
		eye: 1.6,
		phase: 'sunrise',
		dates: [
			[5, 8, 5, 9],
			[8, 5, 8, 6]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0115.html'
	},
	{
		id: 'ktr-117-1',
		num: 117,
		name: '二十曲峠',
		lon: 138.8924,
		lat: 35.45711,
		ground: 1149,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 6, 1, 8],
			[12, 5, 12, 7]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0117.html'
	},
	{
		id: 'ktr-118-1',
		num: 118,
		name: '山中湖親水公園',
		lon: 138.87118,
		lat: 35.42705,
		ground: 985,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 7, 2, 8],
			[11, 3, 11, 4]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-2',
		num: 118,
		name: '高指山',
		lon: 138.92637,
		lat: 35.43293,
		ground: 1173,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 10, 2, 11],
			[10, 30, 10, 31]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-3',
		num: 118,
		name: '大平山',
		lon: 138.87937,
		lat: 35.43899,
		ground: 1295,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 28, 1, 29],
			[11, 13, 11, 14]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-4',
		num: 118,
		name: 'パノラマ台',
		lon: 138.9093,
		lat: 35.41268,
		ground: 1087,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 22, 2, 23],
			[10, 18, 10, 19]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-5',
		num: 118,
		name: '旭日丘湖畔緑地公園',
		lon: 138.87869,
		lat: 35.40827,
		ground: 983,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 23, 2, 24],
			[10, 18, 10, 19]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-6',
		num: 118,
		name: '大池',
		lon: 138.86114,
		lat: 35.41065,
		ground: 987,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[1, 30, 1, 30],
			[11, 12, 11, 13]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-7',
		num: 118,
		name: '平野チビッコ広場',
		lon: 138.90392,
		lat: 35.42627,
		ground: 989,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 18, 2, 19],
			[10, 23, 10, 24]
		],
		approx: true,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-8',
		num: 118,
		name: '山中湖花の都公園',
		lon: 138.85126,
		lat: 35.43924,
		ground: 964,
		eye: 1.6,
		phase: 'sunset',
		dates: [[12, 14, 12, 31]],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	},
	{
		id: 'ktr-118-9',
		num: 118,
		name: '山中湖交流プラザ「きらら」',
		lon: 138.90094,
		lat: 35.42045,
		ground: 984,
		eye: 1.6,
		phase: 'sunset',
		dates: [
			[2, 14, 2, 15],
			[10, 26, 10, 27]
		],
		approx: false,
		url: 'https://www.ktr.mlit.go.jp/chiiki/fujimi0118.html'
	}
];
