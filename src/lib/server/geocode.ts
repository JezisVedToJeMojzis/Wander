// Free geocoding via OpenStreetMap Nominatim. Low-volume / hobby use only; it's
// rate-limited (~1 req/s) and requires an identifying User-Agent. Results are cached
// in-process, and callers persist coordinates on the activity so we rarely re-query.

export type Geo = { lat: string; lng: string };

const cache = new Map<string, Geo | null>();

export async function geocode(query: string): Promise<Geo | null> {
	const key = query.trim().toLowerCase();
	if (!key) return null;
	if (cache.has(key)) return cache.get(key) ?? null;

	try {
		const url =
			'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
			encodeURIComponent(query);
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Wander/1.0 (collaborative trip planner)' }
		});
		if (!res.ok) {
			cache.set(key, null);
			return null;
		}
		const data = (await res.json()) as Array<{ lat: string; lon: string }>;
		const hit = data[0];
		const geo = hit ? { lat: String(hit.lat), lng: String(hit.lon) } : null;
		// Only cache positive hits so transient failures can be retried later.
		if (geo) cache.set(key, geo);
		return geo;
	} catch {
		return null;
	}
}
