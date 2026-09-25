import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';
import type { GtfsFeed } from './feed.ts';
import { activeServices, buildTimetable, positionsAt } from './timetable.ts';

const csv = (s: string) => parseCsv(s.trim().replace(/^\s+/gm, ''));

function feed(): GtfsFeed {
	return {
		agency: csv(`agency_id,agency_name,agency_timezone
			a,テスト交通,Asia/Tokyo`),
		stops: csv(`stop_id,stop_code,stop_name,stop_lat,stop_lon
			s1,T-01,一,35.0,139.0
			s2,T-02,二,35.1,139.0
			s3,T-03,三,35.1,139.2`),
		routes: csv(`route_id,agency_id,route_long_name,route_type,route_color
			r1,a,テスト線,1,FF535F`),
		trips: csv(`route_id,service_id,trip_id,trip_headsign
			r1,wk,t1,三
			r1,wk,late,三
			r1,hol,t2,三`),
		stopTimes: csv(`trip_id,arrival_time,departure_time,stop_id,stop_sequence
			t1,08:00:00,08:00:00,s1,1
			t1,08:10:00,08:11:00,s2,2
			t1,08:20:00,08:20:00,s3,3
			late,23:50:00,23:50:00,s1,1
			late,24:10:00,24:10:00,s2,2
			t2,09:00:00,09:00:00,s1,1
			t2,09:10:00,09:10:00,s2,2`),
		calendar:
			csv(`service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
			wk,1,1,1,1,1,0,0,20260101,20261231
			hol,0,0,0,0,0,1,1,20260101,20261231`),
		calendarDates: csv(`service_id,date,exception_type
			wk,20260923,2
			hol,20260923,1`),
		shapes: [],
		translations: csv(`table_name,field_name,field_value,language,translation
			stops,stop_name,一,en,Ichi`),
		feedInfo: [],
		extra: {}
	};
}

describe('parseCsv', () => {
	it('handles BOM, quotes and CRLF', () => {
		expect(parseCsv('﻿a,b\r\n"x,""y""",2\r\n')).toEqual([{ a: 'x,"y"', b: '2' }]);
	});
});

describe('timetable', () => {
	const tt = buildTimetable(feed());

	it('builds stations, routes and translations', () => {
		expect(tt.stations[0]).toMatchObject({ id: 's1', code: 'T-01', nameEn: 'Ichi' });
		expect(tt.routes[0].color).toBe('#FF535F');
		expect(tt.trips).toHaveLength(3);
	});

	it('applies calendar_dates exceptions (2026-09-23 is a holiday Wednesday)', () => {
		expect([...activeServices(tt, '20260924')]).toEqual(['wk']);
		expect([...activeServices(tt, '20260923')]).toEqual(['hol']);
	});

	it('interpolates between stations and dwells at stops', () => {
		const [moving] = positionsAt(tt, '20260924', 8 * 3600 + 5 * 60);
		expect(moving.trip.id).toBe('t1');
		expect(moving.progress).toBeCloseTo(0.5);
		expect(moving.lat).toBeCloseTo(35.05);

		const [dwell] = positionsAt(tt, '20260924', 8 * 3600 + 10 * 60 + 30);
		expect(dwell.dwelling).toBe(true);
		expect(tt.stations[dwell.from].id).toBe('s2');

		expect(positionsAt(tt, '20260924', 8 * 3600 + 30 * 60)).toHaveLength(0);
	});

	it('includes the previous service day after midnight', () => {
		const [p] = positionsAt(tt, '20260925', 5 * 60);
		expect(p.trip.id).toBe('late');
		expect(p.serviceDate).toBe('20260924');
		expect(p.progress).toBeCloseTo(0.75);
	});
});
