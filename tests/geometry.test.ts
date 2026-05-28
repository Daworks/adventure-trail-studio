import assert from "node:assert/strict";
import test from "node:test";
import { midpoint, segmentDistanceKm } from "../src/domain/geometry";
import type { RouteSegment } from "../src/domain/types";

test("computes the midpoint between two route coordinates", () => {
  assert.deepEqual(midpoint({ lat: 37, lng: 127 }, { lat: 38, lng: 129 }), {
    lat: 37.5,
    lng: 128,
  });
});

test("computes segment distance over consecutive points", () => {
  const segment: RouteSegment = {
    id: "segment-1",
    name: "거리",
    points: [
      { id: "point-1", lat: 37, lng: 127 },
      { id: "point-2", lat: 37.01, lng: 127 },
      { id: "point-3", lat: 37.01, lng: 127.01 },
    ],
  };

  const distance = segmentDistanceKm(segment);
  assert.ok(distance > 1.9);
  assert.ok(distance < 2.1);
});
