// Build a sensible visiting order from a set of voted/added places, balancing
// *how popular* a place is (votes) against *how close* it is to where you already are.
//
// Why not just sort by votes? Because the 2nd-most-voted place might be across town.
// We start at the most-voted place, then at each step pick the next place that scores
// best on a blend of its votes and its closeness to the current point. A far-away
// place only wins if its vote advantage is large enough to outweigh the detour.

export type RoutePlaceInput = {
	id: string;
	title: string;
	score: number;
	lat: number;
	lng: number;
};

export type RouteStop = RoutePlaceInput & {
	/** Straight-line distance from the previous stop, km (0 for the first stop). */
	legKm: number;
};

export type Route = {
	stops: RouteStop[];
	totalKm: number;
};

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
	a: { lat: number; lng: number },
	b: { lat: number; lng: number }
): number {
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export type RouteOptions = {
	/** Relative pull of a place's popularity (0..1). */
	voteWeight?: number;
	/** Relative pull of staying close to the current point (0..1). */
	proximityWeight?: number;
};

export function buildRoute(places: RoutePlaceInput[], opts: RouteOptions = {}): Route {
	const voteWeight = opts.voteWeight ?? 0.5;
	const proximityWeight = opts.proximityWeight ?? 0.5;

	if (places.length === 0) return { stops: [], totalKm: 0 };
	if (places.length === 1) return { stops: [{ ...places[0], legKm: 0 }], totalKm: 0 };

	// Normalise votes across the whole set so weights are comparable.
	const maxScore = Math.max(...places.map((p) => p.score));
	const minScore = Math.min(...places.map((p) => p.score));
	const scoreRange = maxScore - minScore || 1;
	const normVote = (p: RoutePlaceInput) => (p.score - minScore) / scoreRange;

	// Start at the most-voted place (highest score; ties broken arbitrarily).
	const remaining = [...places];
	let startIdx = 0;
	for (let i = 1; i < remaining.length; i++) {
		if (remaining[i].score > remaining[startIdx].score) startIdx = i;
	}
	const stops: RouteStop[] = [{ ...remaining.splice(startIdx, 1)[0], legKm: 0 }];
	let totalKm = 0;

	while (remaining.length > 0) {
		const current = stops[stops.length - 1];
		const dists = remaining.map((p) => haversineKm(current, p));
		const maxDist = Math.max(...dists) || 1;

		let bestIdx = 0;
		let bestCombined = -Infinity;
		for (let i = 0; i < remaining.length; i++) {
			const closeness = 1 - dists[i] / maxDist; // 1 = nearest, 0 = farthest
			const combined = voteWeight * normVote(remaining[i]) + proximityWeight * closeness;
			if (combined > bestCombined) {
				bestCombined = combined;
				bestIdx = i;
			}
		}

		const legKm = dists[bestIdx];
		totalKm += legKm;
		stops.push({ ...remaining.splice(bestIdx, 1)[0], legKm });
	}

	return { stops, totalKm };
}
