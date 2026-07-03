// Build a Google Maps deep link for an activity/place.
// Prefer searching by the place *name* (+ trip destination as a hint): Google resolves
// it to the actual point of interest and opens its details card *selected*. A raw
// lat/lng query only drops an unlabeled pin, so coordinates are just a last resort.
export function googleMapsUrl(opts: {
	lat?: string | null;
	lng?: string | null;
	locationName?: string | null;
	destination?: string | null;
}): string | null {
	const { lat, lng, locationName, destination } = opts;

	// Append the destination as a hint, unless the location already mentions it
	// (avoids "…, Vienna, Vienna" when the user typed a full address).
	const parts = [locationName];
	if (destination && !locationName?.toLowerCase().includes(destination.toLowerCase())) {
		parts.push(destination);
	}
	const query = parts.filter(Boolean).join(', ');
	if (query.trim()) {
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
	}

	if (lat && lng) {
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
	}

	return null;
}

// Build a Google Maps *directions* link visiting an ordered list of coordinates.
// First point = origin, last = destination, the rest become ordered waypoints.
export function googleMapsDirectionsUrl(
	points: Array<{ lat: string | number; lng: string | number }>,
	travelmode: 'walking' | 'driving' | 'transit' | 'bicycling' = 'walking'
): string | null {
	if (points.length === 0) return null;
	const coord = (p: { lat: string | number; lng: string | number }) => `${p.lat},${p.lng}`;

	const destination = encodeURIComponent(coord(points[points.length - 1]));
	let url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=${travelmode}`;

	// With a single point, omit the origin so Google routes from the user's *current
	// location* ("take me there / take me home"). With more, the first point is the origin
	// and the middle ones become ordered waypoints.
	if (points.length >= 2) {
		url += `&origin=${encodeURIComponent(coord(points[0]))}`;
		const waypoints = points
			.slice(1, -1)
			.map(coord)
			.join('|');
		if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
	}
	return url;
}
