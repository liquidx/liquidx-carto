/**
 * Place search via OpenStreetMap Nominatim (keyless, CORS-enabled). Its usage policy allows at
 * most one request per second and no search-as-you-type, so callers search on submit only.
 * https://operations.osmfoundation.org/policies/nominatim/
 */

export interface Place {
	name: string;
	/** The rest of the display name: region, country. */
	detail: string;
	lon: number;
	lat: number;
}

interface NominatimResult {
	name: string;
	display_name: string;
	lat: string;
	lon: string;
}

let last = 0;

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
	const q = query.trim();
	if (!q) return [];
	const wait = last + 1000 - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	last = Date.now();
	const url = new URL('https://nominatim.openstreetmap.org/search');
	url.search = new URLSearchParams({ q, format: 'jsonv2', limit: '6' }).toString();
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`place search failed: http ${res.status}`);
	const results: NominatimResult[] = await res.json();
	return results.map((r) => {
		const parts = r.display_name.split(', ');
		const name = r.name || parts[0];
		return {
			name,
			detail: parts.filter((p) => p !== name).join(', '),
			lon: Number(r.lon),
			lat: Number(r.lat)
		};
	});
}
