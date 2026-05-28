import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConnectSegmentsByEndpoints,
  applyDeletePoint,
  applyDeleteSegment,
  applyConnectSegmentToNext,
  applyInsertPoint,
  applyMovePoint,
  applyReverseSegment,
  applySplitSegmentAtPoint,
  applySplitSegment,
} from "../src/store/editor-operations";
import type { Project, RouteSegment } from "../src/domain/types";

const now = "2026-05-28T00:00:01Z";

test("moves a route point without changing history on no-op coordinates", () => {
  const project = sampleProject();

  const unchanged = applyMovePoint(project, "seg-1", "pt-2", { lat: 37.2, lng: 127.2 }, now);
  assert.equal(unchanged, project);

  const moved = applyMovePoint(project, "seg-1", "pt-2", { lat: 37.25, lng: 127.25 }, now);
  assert.notEqual(moved, project);
  assert.equal(moved.updatedAt, now);
  assert.deepEqual(moved.segments[0].points[1], {
    id: "pt-2",
    lat: 37.25,
    lng: 127.25,
  });
});

test("inserts and deletes points in segment order", () => {
  const project = sampleProject();

  const inserted = applyInsertPoint(
    project,
    "seg-1",
    "pt-1",
    { lat: 37.15, lng: 127.15 },
    fixedId("pt-new"),
    now,
  );
  assert.deepEqual(
    inserted.segments[0].points.map((point) => point.id),
    ["pt-1", "pt-new", "pt-2", "pt-3"],
  );

  const deleted = applyDeletePoint(inserted, "seg-1", "pt-new", now);
  assert.deepEqual(
    deleted.segments[0].points.map((point) => point.id),
    ["pt-1", "pt-2", "pt-3"],
  );
});

test("splits a segment at an interior point and rejects endpoints", () => {
  const project = sampleProject();

  const endpointSplit = applySplitSegment(project, "seg-1", "pt-1", fixedId("seg-new"), now);
  assert.equal(endpointSplit, project);

  const split = applySplitSegment(project, "seg-1", "pt-2", fixedId("seg-new"), now);
  assert.equal(split.segments.length, 2);
  assert.equal(split.segments[0].id, "seg-1");
  assert.equal(split.segments[1].id, "seg-new");
  assert.deepEqual(
    split.segments[0].points.map((point) => point.id),
    ["pt-1", "pt-2"],
  );
  assert.deepEqual(
    split.segments[1].points.map((point) => point.id),
    ["pt-2", "pt-3"],
  );
});

test("splits a segment at a newly inserted line point", () => {
  const project = sampleProject();

  const split = applySplitSegmentAtPoint(
    project,
    "seg-1",
    "pt-1",
    { lat: 37.15, lng: 127.15 },
    fixedSequence(["pt-new", "seg-new"]),
    now,
  );

  assert.equal(split.segments.length, 2);
  assert.deepEqual(
    split.segments[0].points.map((point) => point.id),
    ["pt-1", "pt-new"],
  );
  assert.deepEqual(
    split.segments[1].points.map((point) => point.id),
    ["pt-new", "pt-2", "pt-3"],
  );
});

test("reverses a segment point order", () => {
  const project = sampleProject();

  const reversed = applyReverseSegment(project, "seg-1", now);

  assert.deepEqual(
    reversed.segments[0].points.map((point) => point.id),
    ["pt-3", "pt-2", "pt-1"],
  );
  assert.equal(reversed.updatedAt, now);
});

test("deletes segments and keeps a replacement segment for the final segment", () => {
  const project = {
    ...sampleProject(),
    segments: [...sampleProject().segments, segment("seg-2", ["pt-4", "pt-5"])],
  };

  const deleted = applyDeleteSegment(project, "seg-2", segment("replacement", []), now);
  assert.deepEqual(
    deleted.segments.map((item) => item.id),
    ["seg-1"],
  );

  const reset = applyDeleteSegment(sampleProject(), "seg-1", segment("replacement", []), now);
  assert.deepEqual(
    reset.segments.map((item) => item.id),
    ["replacement"],
  );
});

test("connects a segment to the next segment and removes duplicate connection point", () => {
  const project = {
    ...sampleProject(),
    segments: [
      segment("seg-1", ["pt-1", "pt-2", "pt-3"]),
      segment("seg-2", ["pt-3", "pt-4", "pt-5"]),
    ],
  };

  const connected = applyConnectSegmentToNext(project, "seg-1", now);

  assert.equal(connected.segments.length, 1);
  assert.deepEqual(
    connected.segments[0].points.map((point) => point.id),
    ["pt-1", "pt-2", "pt-3", "pt-4", "pt-5"],
  );
  assert.equal(connected.updatedAt, now);
});

test("connects two segments by clicked endpoints and orients the merged route", () => {
  const project = {
    ...sampleProject(),
    segments: [
      segment("seg-1", ["a-start", "a-mid", "a-finish"]),
      segment("seg-2", ["b-start", "b-mid", "b-finish"]),
    ],
  };

  const connected = applyConnectSegmentsByEndpoints(project, "seg-1", "a-start", "seg-2", "b-finish", now);

  assert.equal(connected.segments.length, 1);
  assert.deepEqual(
    connected.segments[0].points.map((point) => point.id),
    ["a-finish", "a-mid", "a-start", "b-finish", "b-mid", "b-start"],
  );
  assert.equal(connected.updatedAt, now);
});

test("rejects endpoint connection when a clicked point is not a segment endpoint", () => {
  const project = {
    ...sampleProject(),
    segments: [
      segment("seg-1", ["a-start", "a-mid", "a-finish"]),
      segment("seg-2", ["b-start", "b-mid", "b-finish"]),
    ],
  };

  const connected = applyConnectSegmentsByEndpoints(project, "seg-1", "a-mid", "seg-2", "b-start", now);

  assert.equal(connected, project);
});

function sampleProject(): Project {
  return {
    id: "project-1",
    title: "테스트 코스",
    createdAt: "2026-05-28T00:00:00Z",
    updatedAt: "2026-05-28T00:00:00Z",
    segments: [segment("seg-1", ["pt-1", "pt-2", "pt-3"])],
    waypoints: [],
  };
}

function segment(id: string, pointIds: string[]): RouteSegment {
  const coordinates = [
    { lat: 37.1, lng: 127.1 },
    { lat: 37.2, lng: 127.2 },
    { lat: 37.3, lng: 127.3 },
    { lat: 37.4, lng: 127.4 },
    { lat: 37.5, lng: 127.5 },
  ];
  return {
    id,
    name: id,
    points: pointIds.map((pointId, index) => ({
      id: pointId,
      ...coordinates[index],
    })),
  };
}

function fixedId(id: string) {
  return () => id;
}

function fixedSequence(ids: string[]) {
  let index = 0;
  return () => ids[index++] || ids.at(-1) || "id";
}
