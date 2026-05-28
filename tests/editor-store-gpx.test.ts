import assert from "node:assert/strict";
import test from "node:test";
import { useEditorStore } from "../src/store/editor-store";
import { installDomParserStub } from "./dom-parser-stub";

installDomParserStub();

test("imports GPX into the editor project, selection, and undo history", () => {
  const store = useEditorStore;
  store.getState().newProject();
  const before = store.getState().project;

  const result = store.getState().importGpxText(`
    <gpx version="1.1">
      <metadata><name>스토어 GPX</name></metadata>
      <rte>
        <name>팔당 루트</name>
        <rtept lat="37.5" lon="127.0" />
        <rtept lat="37.6" lon="127.1" />
      </rte>
      <wpt lat="37.55" lon="127.05">
        <name>주유소</name>
        <type>fuel</type>
      </wpt>
    </gpx>
  `);

  const state = store.getState();
  assert.equal(result.title, "스토어 GPX");
  assert.equal(state.project.title, "스토어 GPX");
  assert.equal(state.project.segments.length, 1);
  assert.equal(state.project.segments[0].name, "팔당 루트");
  assert.equal(state.project.segments[0].points.length, 2);
  assert.equal(state.project.waypoints.length, 1);
  assert.equal(state.project.waypoints[0].type, "fuel");
  assert.deepEqual(state.selected, { type: "segment", segmentId: state.project.segments[0].id });
  assert.equal(state.history.at(-1), before);
  assert.equal(state.future.length, 0);

  store.getState().undo();
  assert.equal(store.getState().project, before);
});

test("selects an imported waypoint when GPX contains only waypoints", () => {
  const store = useEditorStore;
  store.getState().newProject();

  store.getState().importGpxText(`
    <gpx version="1.1">
      <wpt lat="37.55" lon="127.05">
        <name>주의 지점</name>
        <sym>경고</sym>
      </wpt>
    </gpx>
  `);

  const state = store.getState();
  assert.equal(state.project.segments.length, 1);
  assert.equal(state.project.segments[0].points.length, 0);
  assert.equal(state.project.waypoints.length, 1);
  assert.deepEqual(state.selected, { type: "waypoint", waypointId: state.project.waypoints[0].id });
});
