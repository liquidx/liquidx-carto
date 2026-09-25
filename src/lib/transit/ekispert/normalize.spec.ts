import { describe, expect, it } from 'vitest';
import { asArray, color, course, departures } from './normalize.ts';

// Trimmed from the /search/course/extreme sample in the Ekispert docs.
const sampleCourse = {
	searchType: 'departure',
	dataType: 'onTimetable',
	SerializeData: 'VkV4QaEC',
	Price: [
		{ kind: 'FareSummary', Oneway: '160', Round: '320' },
		{ kind: 'Teiki1Summary', Oneway: '4940' }
	],
	Route: {
		timeOther: '0',
		timeOnBoard: '7',
		distance: '58',
		timeWalk: '0',
		transferCount: '0',
		Line: {
			stopStationCount: '1',
			timeOnBoard: '7',
			trainID: '1722H',
			Name: 'ＪＲ中央・青梅線快速・東京行',
			Type: 'train',
			ArrivalState: {
				no: '8',
				Datetime: { text: '2020-08-13T18:48:00+09:00', operation: 'today' }
			},
			Destination: '東京',
			DepartureState: {
				no: '4',
				Datetime: { text: '2020-08-13T18:41:00+09:00', operation: 'today' }
			},
			LineSymbol: { code: '8', Name: 'JC' },
			Color: '255090035'
		},
		Point: [
			{
				Station: { code: '22671', Name: '高円寺', Type: 'train' },
				Prefecture: { code: '13', Name: '東京都' },
				GeoPoint: { longi_d: '139.653027', lati_d: '35.70211', gcs: 'wgs84' }
			},
			{
				Station: { code: '22741', Name: '新宿', Type: 'train' },
				GeoPoint: { longi_d: '139.703056', lati_d: '35.6875', gcs: 'wgs84' }
			}
		]
	}
};

describe('ekispert normalize', () => {
	it('wraps single objects and missing values as arrays', () => {
		expect(asArray(undefined)).toEqual([]);
		expect(asArray({ a: 1 })).toEqual([{ a: 1 }]);
	});

	it('decodes RRRGGGBBB colours', () => {
		expect(color('255090035')).toBe('#FF5A23');
		expect(color(undefined)).toBeUndefined();
	});

	it('flattens a course with a single Line object', () => {
		const c = course(sampleCourse);
		expect(c).toMatchObject({ fare: 160, teiki1: 4940, transferCount: 0, distanceKm: 5.8 });
		expect(c.legs).toHaveLength(1);
		expect(c.legs[0]).toMatchObject({
			from: { code: '22671', name: '高円寺', lat: 35.70211 },
			to: { code: '22741', name: '新宿' },
			departure: '2020-08-13T18:41:00+09:00',
			departurePlatform: '4',
			lineSymbol: 'JC',
			color: '#FF5A23'
		});
	});

	it('flattens a station timetable into departures', () => {
		const deps = departures({
			HourTable: [
				{
					Hour: '6',
					MinuteTable: [
						{
							Minute: '7',
							Stop: {
								kindCode: '1',
								destinationCode: '1',
								nameCode: '1',
								lineCode: '29868',
								platformNo: '3'
							}
						}
					]
				}
			],
			LineKind: { text: '各駅停車', code: '1' },
			LineDestination: [{ text: '高尾(東京都)', code: '1' }],
			LineName: { text: '無し', code: '1' }
		});
		expect(deps).toEqual([
			{
				time: '06:07',
				kind: '各駅停車',
				destination: '高尾(東京都)',
				trainName: '無し',
				platform: '3',
				trainCode: '29868'
			}
		]);
	});
});
