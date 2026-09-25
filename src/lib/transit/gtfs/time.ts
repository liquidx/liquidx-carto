/** Parse a GTFS time ("HH:MM:SS", hours may exceed 24) to seconds since the start of the service day. */
export function parseGtfsTime(s: string): number {
	if (!s) return NaN;
	const [h, m, sec] = s.trim().split(':');
	return Number(h) * 3600 + Number(m) * 60 + Number(sec ?? 0);
}

/** Format seconds as "HH:MM:SS"; hours are not wrapped, so 25:10:00 stays 25:10:00. */
export function formatGtfsTime(t: number): string {
	const h = Math.floor(t / 3600);
	const m = Math.floor((t % 3600) / 60);
	const s = Math.floor(t % 60);
	return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** "YYYYMMDD" → day of week, 0 = Sunday. */
export function dayOfWeek(date: string): number {
	return new Date(
		Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8))
	).getUTCDay();
}

/** Shift a "YYYYMMDD" date by whole days. */
export function addDays(date: string, days: number): string {
	const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + days));
	return d.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Current date ("YYYYMMDD") and seconds since midnight in a given IANA time zone. */
export function nowIn(timeZone = 'Asia/Tokyo', at = new Date()): { date: string; seconds: number } {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(at)
			.map((p) => [p.type, p.value])
	);
	return {
		date: `${parts.year}${parts.month}${parts.day}`,
		seconds: +parts.hour * 3600 + +parts.minute * 60 + +parts.second
	};
}
