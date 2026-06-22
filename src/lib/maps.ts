// Build a Google Maps deep link for an activity/place.
// Prefer precise coordinates; otherwise search by the place name (+ trip destination
// as a disambiguating hint). Returns null when there's nothing to point at.
export function googleMapsUrl(opts: {
	lat?: string | null;
	lng?: string | null;
	locationName?: string | null;
	destination?: string | null;
}): string | null {
	const { lat, lng, locationName, destination } = opts;

	if (lat && lng) {
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
	}

	const query = [locationName, destination].filter(Boolean).join(', ');
	if (query.trim()) {
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
	}

	return null;
}

// Build a Google Maps *directions* link visiting an ordered list of coordinates.
// First point = origin, last = destination, the rest become ordered waypoints.
export function googleMapsDirectionsUrl(
	points: Array<{ lat: string | number; lng: string | number }>,
	travelmode: 'walking' | 'driving' | 'transit' | 'bicycling' = 'walking'
): string | null {
	if (points.length < 2) return null;
	const coord = (p: { lat: string | number; lng: string | number }) => `${p.lat},${p.lng}`;

	const origin = encodeURIComponent(coord(points[0]));
	const destination = encodeURIComponent(coord(points[points.length - 1]));
	const waypoints = points
		.slice(1, -1)
		.map(coord)
		.join('|');

	let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${travelmode}`;
	if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
	return url;
}
