import { buildRoute } from '$lib/route';
import { googleMapsDirectionsUrl } from '$lib/maps';

// A trip activity reduced to what the route view needs.
export type Decorated = {
	id: string;
	title: string;
	score: number;
	category: string;
	locationName: string | null;
	lat: string | null;
	lng: string | null;
};

export type StopView = Decorated & {
	/** Distance from the previous stop in this bucket's mini-route (km). */
	legKm: number;
	hasCoords: boolean;
};

export type GroupRow = {
	id: string;
	name: string;
	kind: 'day' | 'custom';
	dayDate: string | null;
};

export type GroupView = GroupRow & {
	stops: StopView[];
	totalKm: number;
	mapsUrl: string | null;
};

export type ScopeView = {
	groups: GroupView[];
	unassigned: StopView[];
	unassignedTotalKm: number;
	unassignedMapsUrl: string | null;
};

const hasCoords = (a: Decorated) =>
	!!a.lat && !!a.lng && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

// Order a bucket of activities into a proximity+votes mini-route. Places without
// coordinates can't be routed, so they're appended at the end.
function buildStops(acts: Decorated[]): {
	stops: StopView[];
	totalKm: number;
	mapsUrl: string | null;
} {
	const coordActs = acts.filter(hasCoords);
	const route = buildRoute(
		coordActs.map((a) => ({
			id: a.id,
			title: a.title,
			score: a.score,
			lat: Number(a.lat),
			lng: Number(a.lng)
		}))
	);
	const byId = new Map(acts.map((a) => [a.id, a]));

	const ordered: StopView[] = route.stops.map((s) => ({
		...byId.get(s.id)!,
		legKm: s.legKm,
		hasCoords: true
	}));
	const noCoord: StopView[] = acts
		.filter((a) => !hasCoords(a))
		.map((a) => ({ ...a, legKm: 0, hasCoords: false }));

	return {
		stops: [...ordered, ...noCoord],
		totalKm: route.totalKm,
		mapsUrl: googleMapsDirectionsUrl(route.stops)
	};
}

export function assembleScope(
	candidates: Decorated[],
	groups: GroupRow[],
	itemsByGroup: Map<string, string[]>,
	allById: Map<string, Decorated>
): ScopeView {
	// Only items in *this scope's* groups count as assigned (a place can be in one of
	// my personal groups and, independently, one shared group).
	const assigned = new Set<string>();
	for (const g of groups) for (const id of itemsByGroup.get(g.id) ?? []) assigned.add(id);

	const groupViews: GroupView[] = groups.map((g) => {
		const ids = itemsByGroup.get(g.id) ?? [];
		const acts = ids.map((id) => allById.get(id)).filter((a): a is Decorated => !!a);
		const built = buildStops(acts);
		return { ...g, stops: built.stops, totalKm: built.totalKm, mapsUrl: built.mapsUrl };
	});

	const unassigned = buildStops(candidates.filter((a) => !assigned.has(a.id)));
	return {
		groups: groupViews,
		unassigned: unassigned.stops,
		unassignedTotalKm: unassigned.totalKm,
		unassignedMapsUrl: unassigned.mapsUrl
	};
}

// Sort: dated day-groups first (chronological), then custom groups by position.
export function sortGroups<T extends GroupRow & { position?: number }>(groups: T[]): T[] {
	return [...groups].sort((a, b) => {
		if (a.dayDate && b.dayDate) return a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0;
		if (a.dayDate) return -1;
		if (b.dayDate) return 1;
		return (a.position ?? 0) - (b.position ?? 0);
	});
}
