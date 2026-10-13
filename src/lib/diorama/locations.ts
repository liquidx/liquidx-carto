import { asset } from '$app/paths';

/** A resort a page can be pointed at, as snowline names it. */
export type ListedLocation = { id: string; nameEn: string; nameJa: string; tier?: number };
type IndexEntry = { locationId: string; shortNameEn: string; shortNameJa: string; tier?: number };

let locations: Promise<ListedLocation[]> | undefined;
/**
 * The resorts to pick from: snowline's index of every resort, cut down to the ones there is
 * terrain data for (`pnpm snowboard-locations`). Read once, however often the resort changes.
 */
export function loadLocations(fetch: typeof globalThis.fetch) {
	const json = <T>(path: string) =>
		fetch(asset(path)).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)));
	locations ??= Promise.all([
		json<IndexEntry[]>('/snowline-locations-index.json'),
		json<string[]>('/terrain-locations.json')
	])
		.then(([index, terrain]) => {
			const ids = new Set(terrain);
			return index
				.filter((l) => ids.has(l.locationId))
				.map((l) => ({
					id: l.locationId,
					nameEn: l.shortNameEn,
					nameJa: l.shortNameJa,
					tier: l.tier
				}))
				.sort((a, b) => a.nameEn.localeCompare(b.nameEn, 'en'));
		})
		.catch(() => {
			// Try again on the next load; a resort in the URL can still be shown.
			locations = undefined;
			return [];
		});
	return locations;
}

/** The resorts as options to pick from, by both their names; the top three tiers get 3, 2 and 1 stars. */
export const locationOptions = (locations: ListedLocation[]) =>
	locations.map((l) => ({
		value: l.id,
		label: `${l.nameEn} · ${l.nameJa}`,
		mark: '★'.repeat(Math.max(0, 4 - (l.tier ?? 4)))
	}));
