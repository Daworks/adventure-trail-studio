import assert from "node:assert/strict";
import test from "node:test";
import { redoHistory, undoHistory } from "../src/store/editor-history";
import type { Project } from "../src/domain/types";

test("undo moves the current project into future and restores the last history snapshot", () => {
  const first = project("first");
  const second = project("second");
  const current = project("current");

  const result = undoHistory({
    project: current,
    history: [first, second],
    future: [],
    selected: { type: "segment", segmentId: "seg-current" },
  });

  assert.ok(result);
  assert.equal(result.project, second);
  assert.deepEqual(result.history, [first]);
  assert.deepEqual(result.future, [current]);
  assert.equal(result.selected, null);
});

test("redo moves the current project into history and restores the first future snapshot", () => {
  const history = project("history");
  const current = project("current");
  const next = project("next");
  const later = project("later");

  const result = redoHistory({
    project: current,
    history: [history],
    future: [next, later],
    selected: { type: "point", segmentId: "seg-current", pointId: "pt-current" },
  });

  assert.ok(result);
  assert.equal(result.project, next);
  assert.deepEqual(result.history, [history, current]);
  assert.deepEqual(result.future, [later]);
  assert.equal(result.selected, null);
});

test("undo and redo are no-ops when their stacks are empty", () => {
  const current = project("current");

  assert.equal(
    undoHistory({ project: current, history: [], future: [], selected: null }),
    undefined,
  );
  assert.equal(
    redoHistory({ project: current, history: [], future: [], selected: null }),
    undefined,
  );
});

function project(id: string): Project {
  return {
    id,
    title: id,
    createdAt: "2026-05-28T00:00:00Z",
    updatedAt: "2026-05-28T00:00:00Z",
    segments: [
      {
        id: `seg-${id}`,
        name: id,
        points: [],
      },
    ],
    waypoints: [],
  };
}
