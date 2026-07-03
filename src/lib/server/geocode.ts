// Free geocoding via OpenStreetMap Nominatim. Low-volume / hobby use only; it's
// rate-limited (~1 req/s) and requires an identifying User-Agent. To stay within that
// limit we push every lookup through a single global queue, spaced ~1.1s apart, so bursts
// (e.g. adding several activities at once) never trip a 429. Results are cached in-process,
// and callers persist coordinates on the activity so we rarely re-query.

export type Geo = { lat: string; lng: string };

const cache = new Map<string, Geo | null>();

// Serialize all lookups: one request at a time, politely spaced.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

async function spaceOutRequests() {
	const minGapMs = 1100;
	const wait = minGapMs - (Date.now() - lastRequestAt);
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastRequestAt = Date.now();
}

async function lookup(query: string, key: string): Promise<Geo | null> {
	await spaceOutRequests();
	const url =
		'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
		encodeURIComponent(query);
	const res = await fetch(url, {
		headers: { 'User-Agent': 'Wander/1.0 (collaborative trip planner)' }
	});
	// Only cache a *definitive* answer. A transient failure (rate limit, server error,
	// network) returns null WITHOUT caching, so the place is retried on a later visit —
	// otherwise one 429 would permanently mark a real location as unresolvable.
	if (!res.ok) return null;
	const data = (await res.json()) as Array<{ lat: string; lon: string }>;
	const hit = data[0];
	const geo = hit ? { lat: String(hit.lat), lng: String(hit.lon) } : null;
	cache.set(key, geo);
	return geo;
}

export async function geocode(query: string): Promise<Geo | null> {
	const key = query.trim().toLowerCase();
	if (!key) return null;
	if (cache.has(key)) return cache.get(key) ?? null;

	// Chain onto the queue so requests go out one-at-a-time, spaced politely.
	const run = queue.then(async () => {
		if (cache.has(key)) return cache.get(key) ?? null; // may have resolved while queued
		try {
			return await lookup(query, key);
		} catch {
			return null; // network error — don't cache; allow a retry later
		}
	});
	queue = run.catch(() => {});
	return run;
}
