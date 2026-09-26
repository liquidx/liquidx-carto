/**
 * Touring-route gap analysis. Each route is a polyline of waypoints; fast chargers within 12 km
 * of it are placed at their distance along the line, and the longest gap between consecutive
 * chargers (or a route end) is reported, for all chargers and for 24h ones only.
 */
import type { Route } from '../model.ts';
import { haversine } from './geo.ts';

type Waypoint = [lon: number, lat: number];

export const ROUTES: Record<string, Waypoint[]> = {
	'Okhotsk coast 網走→稚内': [
		[144.274, 44.021],
		[143.354, 44.356],
		[142.958, 44.585],
		[142.583, 44.94],
		[142.363, 45.117],
		[141.937, 45.523],
		[141.673, 45.415]
	],
	'Sea of Japan 稚内→小樽': [
		[141.673, 45.415],
		[141.745, 44.885],
		[141.7, 44.359],
		[141.643, 43.943],
		[141.3, 43.5],
		[140.994, 43.19]
	],
	'Shiretoko/Nemuro 釧路→網走': [
		[144.382, 42.985],
		[145.583, 43.33],
		[145.121, 43.394],
		[144.976, 43.554],
		[145.128, 43.657],
		[145.196, 44.023],
		[144.994, 44.076],
		[144.664, 43.909],
		[144.274, 44.021]
	],
	'Hidaka/Erimo 苫小牧→帯広': [
		[141.604, 42.637],
		[142.368, 42.341],
		[142.768, 42.168],
		[143.246, 41.925],
		[143.312, 42.284],
		[143.196, 42.924]
	],
	'Central 札幌→北見': [
		[141.354, 43.062],
		[142.365, 43.771],
		[143.03, 43.72],
		[143.895, 43.803]
	],
	'South loop 札幌→函館→小樽': [
		[141.354, 43.062],
		[140.766, 42.593],
		[140.729, 41.768],
		[140.109, 41.43],
		[140.128, 41.869],
		[139.85, 42.451],
		[140.224, 42.794],
		[140.51, 42.976],
		[140.994, 43.19]
	]
};

/** How close a charger must be to the route line to count, km. */
const CORRIDOR_KM = 12;
/** Longitude scale for projecting onto segments, fixed at Hokkaido's middle latitude. */
const K = Math.cos((43.5 * Math.PI) / 180);

export interface RouteSite {
	lon: number;
	lat: number;
	name: string;
	open24h: boolean;
}

/** Position along segment a→b (0–1) and distance from it (km), in a local flat projection. */
function project(p: Waypoint, a: Waypoint, b: Waypoint) {
	const [ax, ay, bx, by, px, py] = [a[0] * K, a[1], b[0] * K, b[1], p[0] * K, p[1]];
	const dx = bx - ax;
	const dy = by - ay;
	const l2 = dx * dx + dy * dy;
	const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
	return { t, d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111 };
}

export function analyseRoute(name: string, wp: Waypoint[], sites: RouteSite[]): Route {
	const cum = [0];
	for (let i = 1; i < wp.length; i++) cum.push(cum[i - 1] + haversine(...wp[i - 1], ...wp[i]));
	const total = cum[cum.length - 1];

	/** Sites in the corridor as [km along, name], sorted along the route. */
	const place = (list: RouteSite[]) =>
		list
			.map((s) => {
				let best = { along: 0, d: Infinity };
				for (let i = 0; i < wp.length - 1; i++) {
					const { t, d } = project([s.lon, s.lat], wp[i], wp[i + 1]);
					if (d < best.d) best = { along: cum[i] + t * (cum[i + 1] - cum[i]), d };
				}
				return { ...best, name: s.name };
			})
			.filter((s) => s.d <= CORRIDOR_KM)
			.sort((a, b) => a.along - b.along);

	const longestGap = (placed: { along: number; name: string }[]) => {
		if (!placed.length) return { gap: total, after: '(none on route)' };
		const marks = [
			{ along: 0, name: 'route start' },
			...placed,
			{ along: total, name: 'route end' }
		];
		let gap = 0;
		let after = '';
		for (let i = 1; i < marks.length; i++) {
			const g = marks[i].along - marks[i - 1].along;
			if (g > gap) [gap, after] = [g, marks[i - 1].name];
		}
		return { gap, after };
	};

	const a = place(sites);
	const b = place(sites.filter((s) => s.open24h));
	const ga = longestGap(a);
	const gb = longestGap(b);
	return {
		name,
		n: a.length,
		gap: Math.round(ga.gap),
		after: ga.after,
		n24: b.length,
		gap24: Math.round(gb.gap),
		after24: gb.after,
		km: Math.round(total)
	};
}

export const analyseRoutes = (sites: RouteSite[]) =>
	Object.entries(ROUTES).map(([name, wp]) => analyseRoute(name, wp, sites));
