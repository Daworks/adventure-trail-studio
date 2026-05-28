import assert from "node:assert/strict";
import test from "node:test";
import { computeProjectRenderInfo } from "../src/map/adapter";
import type { Project, RoutePoint } from "../src/domain/types";

test("limits rendered route detail and selected point handles for large projects", () => {
  const project = largeProject(10000);

  const info = computeProjectRenderInfo(project, {
    selectedSegmentId: "segment-1",
    showPointHandles: true,
    showRoutes: true,
    showWaypoints: true,
  });

  assert.equal(info.totalRoutePoints, 10000);
  assert.ok(info.renderedRoutePoints < 10000);
  assert.ok(info.renderedRoutePoints >= 2);
  assert.ok(info.renderedPointHandles <= 361);
  assert.ok(info.hiddenPointHandles > 0);
});

test("respects route and handle visibility switches in render info", () => {
  const project = largeProject(2000);

  assert.deepEqual(computeProjectRenderInfo(project, { selectedSegmentId: "segment-1", showRoutes: false }), {
    hiddenPointHandles: 0,
    renderedPointHandles: 0,
    renderedRoutePoints: 0,
    totalRoutePoints: 2000,
  });

  const withoutHandles = computeProjectRenderInfo(project, {
    selectedSegmentId: "segment-1",
    showPointHandles: false,
    showRoutes: true,
  });
  assert.equal(withoutHandles.hiddenPointHandles, 0);
  assert.equal(withoutHandles.renderedPointHandles, 0);
  assert.ok(withoutHandles.renderedRoutePoints > 0);
});

test("renders edit handles only at shape-changing points on straight-heavy routes", () => {
  const straightProject = projectFromPoints("straight", [
    { lat: 37, lng: 127 },
    { lat: 37, lng: 127.01 },
    { lat: 37, lng: 127.02 },
    { lat: 37, lng: 127.03 },
    { lat: 37, lng: 127.04 },
  ]);

  const straightInfo = computeProjectRenderInfo(straightProject, {
    selectedSegmentId: "segment-1",
    showPointHandles: true,
    showRoutes: true,
  });
  assert.equal(straightInfo.renderedPointHandles, 2);
  assert.equal(straightInfo.hiddenPointHandles, 3);

  const turnProject = projectFromPoints("turn", [
    { lat: 37, lng: 127 },
    { lat: 37, lng: 127.01 },
    { lat: 37, lng: 127.02 },
    { lat: 37.01, lng: 127.02 },
    { lat: 37.02, lng: 127.02 },
  ]);

  const turnInfo = computeProjectRenderInfo(turnProject, {
    selectedSegmentId: "segment-1",
    showPointHandles: true,
    showRoutes: true,
  });
  assert.equal(turnInfo.renderedPointHandles, 3);
  assert.equal(turnInfo.hiddenPointHandles, 2);
});

function projectFromPoints(id: string, points: Array<Pick<RoutePoint, "lat" | "lng">>): Project {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    segments: [
      {
        id: "segment-1",
        name: "구간 1",
        points: points.map((point, index) => ({
          id: `point-${index}`,
          ...point,
        })),
      },
    ],
    title: id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    waypoints: [],
  };
}

function largeProject(pointCount: number): Project {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "project-1",
    segments: [
      {
        id: "segment-1",
        name: "대용량 구간",
        points: Array.from({ length: pointCount }, (_, index): RoutePoint => {
          const t = index / Math.max(1, pointCount - 1);
          return {
            id: `point-${index}`,
            lat: 37 + t * 0.6 + Math.sin(index / 21) * 0.01,
            lng: 127 + t * 0.7 + Math.cos(index / 19) * 0.01,
          };
        }),
      },
    ],
    title: "대용량 GPX",
    updatedAt: "2026-01-01T00:00:00.000Z",
    waypoints: [
      {
        id: "waypoint-1",
        lat: 37.5,
        lng: 127.5,
        title: "휴식",
        type: "food",
      },
    ],
  };
}
