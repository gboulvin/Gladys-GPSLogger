// -----------------------------------------------------------------------------
// Geographic helpers: great-circle distance and map links.
// -----------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in meters (haversine formula:
 * precise to a few meters at the scale of a city, which GPS accuracy is not).
 * @param {{ latitude: number, longitude: number }} a
 * @param {{ latitude: number, longitude: number }} b
 */
export function distanceMeters(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Round to `digits` decimals. */
export function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** OpenStreetMap link centered on a position, with a marker. */
export function mapsUrl(latitude, longitude) {
  const lat = round(latitude, 6);
  const lon = round(longitude, 6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

/** Human-readable coordinates, e.g. "48.85837, 2.29448". */
export function formatCoordinates(latitude, longitude) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
