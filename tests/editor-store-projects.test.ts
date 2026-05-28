import assert from "node:assert/strict";
import test from "node:test";
import { useEditorStore } from "../src/store/editor-store";
import type { Project } from "../src/domain/types";

test("loads projects from the project API", async () => {
  const project = projectFixture("project-api-1", "저장된 코스");
  const calls = mockFetch([
    jsonResponse([project]),
  ]);

  await useEditorStore.getState().loadProjects();

  assert.deepEqual(useEditorStore.getState().projects, [project]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/projects");
});

test("saves the active project and refreshes the project list", async () => {
  useEditorStore.getState().newProject();
  useEditorStore.getState().updateTitle("저장 대상");
  const active = useEditorStore.getState().project;
  const calls = mockFetch([
    textResponse("ok"),
    jsonResponse([active]),
  ]);

  await useEditorStore.getState().saveProject();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/projects");
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), active);
  assert.deepEqual(useEditorStore.getState().projects, [active]);
});

test("opens projects with an editable fallback segment and clears history", async () => {
  useEditorStore.getState().newProject();
  useEditorStore.getState().addPoint({ lat: 37, lng: 127 });
  assert.ok(useEditorStore.getState().history.length > 0);
  const emptyProject = { ...projectFixture("project-api-2", "빈 코스"), segments: [] };
  mockFetch([jsonResponse(emptyProject)]);

  await useEditorStore.getState().openProject(emptyProject.id);

  const state = useEditorStore.getState();
  assert.equal(state.project.id, emptyProject.id);
  assert.equal(state.project.segments.length, 1);
  assert.deepEqual(state.selected, { type: "segment", segmentId: state.project.segments[0].id });
  assert.equal(state.history.length, 0);
  assert.equal(state.future.length, 0);
});

test("delete project resets the active editor when deleting the open project", async () => {
  const project = projectFixture("project-api-3", "삭제 대상");
  mockFetch([
    jsonResponse(project),
    textResponse("deleted"),
    jsonResponse([]),
  ]);

  await useEditorStore.getState().openProject(project.id);
  await useEditorStore.getState().deleteProject(project.id);

  const state = useEditorStore.getState();
  assert.notEqual(state.project.id, project.id);
  assert.equal(state.project.title, "무제 투어링 코스");
  assert.deepEqual(state.projects, []);
});

test("surfaces project API error details", async () => {
  mockFetch([new Response("database unavailable", { status: 500 })]);

  await assert.rejects(
    useEditorStore.getState().saveProject(),
    /프로젝트를 저장하지 못했습니다.: database unavailable/,
  );
});

function projectFixture(id: string, title: string): Project {
  return {
    createdAt: "2026-05-28T00:00:00.000Z",
    id,
    segments: [
      {
        id: `${id}-segment-1`,
        name: "구간 1",
        points: [
          { id: `${id}-point-1`, lat: 37.1, lng: 127.1 },
          { id: `${id}-point-2`, lat: 37.2, lng: 127.2 },
        ],
      },
    ],
    title,
    updatedAt: "2026-05-28T00:00:00.000Z",
    waypoints: [],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function textResponse(value: string): Response {
  return new Response(value, { status: 200 });
}

function mockFetch(responses: Response[]): Array<{ init?: RequestInit; url: string }> {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: String(input) });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch call");
    return response;
  };
  return calls;
}
