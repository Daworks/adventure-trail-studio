import assert from "node:assert/strict";
import test from "node:test";
import { midpoint } from "../src/domain/geometry";
import { useEditorStore } from "../src/store/editor-store";

test("undo and redo restore point movement, insertion, and deletion", () => {
  const store = useEditorStore.getState();
  store.newProject();
  store.addPoint({ lat: 37.1, lng: 127.1 });
  store.addPoint({ lat: 37.2, lng: 127.2 });
  const segment = useEditorStore.getState().project.segments[0];
  const [firstPoint, secondPoint] = segment.points;

  useEditorStore.getState().movePoint(segment.id, firstPoint.id, { lat: 37.15, lng: 127.15 });
  assert.deepEqual(useEditorStore.getState().project.segments[0].points[0], {
    id: firstPoint.id,
    lat: 37.15,
    lng: 127.15,
  });
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project.segments[0].points[0], firstPoint);
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project.segments[0].points[0].lat, 37.15);

  const movedFirstPoint = useEditorStore.getState().project.segments[0].points[0];
  useEditorStore.getState().insertPoint(segment.id, movedFirstPoint.id, midpoint(movedFirstPoint, secondPoint));
  assert.equal(useEditorStore.getState().project.segments[0].points.length, 3);
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project.segments[0].points.length, 2);
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project.segments[0].points.length, 3);

  const insertedPoint = useEditorStore.getState().project.segments[0].points[1];
  useEditorStore.getState().deletePoint(segment.id, insertedPoint.id);
  assert.equal(useEditorStore.getState().project.segments[0].points.length, 2);
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project.segments[0].points.length, 3);
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project.segments[0].points.length, 2);
});

test("undo and redo restore segment split and deletion", () => {
  const store = useEditorStore.getState();
  store.newProject();
  store.addPoint({ lat: 37.1, lng: 127.1 });
  store.addPoint({ lat: 37.2, lng: 127.2 });
  store.addPoint({ lat: 37.3, lng: 127.3 });
  const segment = useEditorStore.getState().project.segments[0];
  const middlePoint = segment.points[1];

  useEditorStore.getState().splitSegment(segment.id, middlePoint.id);
  assert.equal(useEditorStore.getState().project.segments.length, 2);
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project.segments.length, 1);
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project.segments.length, 2);

  const secondSegment = useEditorStore.getState().project.segments[1];
  useEditorStore.getState().deleteSegment(secondSegment.id);
  assert.equal(useEditorStore.getState().project.segments.length, 1);
  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project.segments.length, 2);
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project.segments.length, 1);
});
