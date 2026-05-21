/**
 * Great-circle distance between two points in kilometers, using the
 * Haversine formula. Accurate enough for ETA estimation at city scale —
 * we don't need road-network routing in pilot.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * ETA constant for Kinshasa pilot. Real road networks + traffic vary a lot;
 * 15 minutes per kilometer is a reasonable city-bike-courier estimate.
 * Tweakable per vehicle type later.
 */
export const ETA_MINUTES_PER_KM = 15;

export function etaFromDistanceKm(distanceKm: number): Date {
  const minutes = Math.max(5, Math.round(distanceKm * ETA_MINUTES_PER_KM));
  return new Date(Date.now() + minutes * 60 * 1000);
}
