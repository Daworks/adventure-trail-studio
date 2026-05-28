import type { RoutePoint, RouteSegment } from "./types";

export function segmentDistanceKm(segment: RouteSegment): number {
  let total = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    total += distanceKm(segment.points[index - 1], segment.points[index]);
  }
  return total;
}

export function totalDistanceKm(segments: RouteSegment[]): number {
  return segments.reduce((sum, segment) => sum + segmentDistanceKm(segment), 0);
}

export function distanceKm(a: RoutePoint, b: RoutePoint): number {
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function midpoint(a: Pick<RoutePoint, "lat" | "lng">, b: Pick<RoutePoint, "lat" | "lng">): Omit<RoutePoint, "id"> {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}
